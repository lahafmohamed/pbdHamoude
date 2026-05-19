import { Request, Response } from 'express';
import pool from '../db/connection';
import { produitService } from '../services/ProduitService';
import {
  buildMagasinProductsQuery,
  isMagasinLocationId,
  getDefaultMagasinLocationId,
  SALES_DEPOT_ERROR_MESSAGE,
} from '../services/StockMagasinService';
import { successResponse, errorResponse } from '../utils/response';
import { AuthRequest } from '../middleware/auth';
import { logAudit } from '../middleware/audit';
import { parsePagination } from '../utils/pagination';

export class ProduitController {

  /**
   * GET /api/produits/ventes
   * Magasin-only product picker for Factures and Devis forms.
   * Dépôt rows are excluded at SQL level. If a location_id is provided,
   * it MUST be a magasin or the request is rejected with 422.
   */
  static async getAllVentes(req: Request, res: Response): Promise<void> {
    try {
      const { search, categorie, location_id } = req.query;
      const locationId = location_id ? parseInt(location_id as string, 10) : undefined;

      if (location_id !== undefined && Number.isNaN(locationId)) {
        res.status(400).json({ success: false, error: 'Location ID invalide' });
        return;
      }

      if (locationId !== undefined) {
        const ok = await isMagasinLocationId(locationId);
        if (!ok) {
          res.status(422).json({ success: false, error: SALES_DEPOT_ERROR_MESSAGE });
          return;
        }
      } else {
        // Surface a clear error if no magasin is configured at all.
        try {
          await getDefaultMagasinLocationId();
        } catch (err: any) {
          res.status(500).json({ success: false, error: err.message });
          return;
        }
      }

      const { page, limit, sort, order } = parsePagination(req.query, { sort: 'nom', order: 'ASC' });

      const { sql, params } = buildMagasinProductsQuery({
        search: search ? String(search) : undefined,
        categorie: categorie ? String(categorie) : undefined,
        locationId,
      });

      const ALLOWED_SORT: Record<string, string> = {
        nom: 'p.nom',
        reference: 'p.reference',
        categorie: 'p.categorie',
        prix_vente: 'p.prix_vente',
        stock: 'stock',
        created_at: 'p.created_at',
      };
      const sortColumn = ALLOWED_SORT[String(sort)] || 'p.nom';
      const sortOrder = String(order).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      const offset = (page - 1) * limit;

      const dataSql = `${sql} ORDER BY ${sortColumn} ${sortOrder} LIMIT ${limit} OFFSET ${offset}`;
      const countSql = `SELECT COUNT(*) AS total FROM (${sql}) AS picker`;

      const [dataResult, countResult] = await Promise.all([
        pool.query(dataSql, params),
        pool.query(countSql, params),
      ]);

      const total = parseInt(countResult.rows[0].total, 10);
      res.json(
        successResponse(dataResult.rows, undefined, {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        }),
      );
    } catch (error: any) {
      loggerError('GET /api/produits/ventes', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  /**
   * GET /api/produits/ventes/locations
   * Magasin-only locations for the Ventes location selector.
   */
  static async getVentesLocations(_req: Request, res: Response): Promise<void> {
    try {
      const { rows } = await pool.query(
        `SELECT id, code, nom, est_principal
         FROM stock_locations
         WHERE actif = true
           AND NOT (
             UPPER(code) LIKE 'DEPOT%'
             OR UPPER(nom) LIKE '%DÉPÔT%'
             OR UPPER(nom) LIKE '%DEPOT%'
           )
         ORDER BY est_principal DESC, id ASC`,
      );
      res.json(successResponse(rows));
    } catch (error: any) {
      loggerError('GET /api/produits/ventes/locations', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, categorie, low_stock, location_id } = req.query;
      const locationId = location_id ? parseInt(location_id as string, 10) : undefined;

      if (location_id && Number.isNaN(locationId)) {
        res.status(400).json({ success: false, error: 'Location ID invalide' });
        return;
      }

      const { page, limit, sort, order } = parsePagination(req.query, { sort: 'nom', order: 'ASC' });
      const result = await produitService.getAll(
        search as string,
        categorie as string,
        low_stock === 'true',
        { page, limit, sort, order },
        locationId
      );
      res.json(successResponse(result.data, undefined, result.pagination));
    } catch (error: any) {
      if (error?.message === 'Depot invalide ou inactif') {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      loggerError('GET /api/produits', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const produit = await produitService.findById(parseInt(req.params.id));
      if (!produit) {
        res.status(404).json({ success: false, error: 'Produit non trouvé' });
        return;
      }
      res.json(successResponse(produit));
    } catch (error) {
      loggerError('GET /api/produits/:id', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async create(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const produit = await produitService.create({
        ...req.body,
        cree_par: authReq.user?.id,
      });

      await logAudit({
        utilisateur_id: authReq.user?.id || null,
        action: 'create',
        table_name: 'produits',
        record_id: produit.id,
        req,
        new_values: produit,
      });

      res.status(201).json(successResponse(produit, 'Produit créé'));
    } catch (error: any) {
      if (error.code === '23505') {
        res.status(400).json({ success: false, error: 'Cette référence existe déjà' });
        return;
      }
      if (error.message === 'Depot invalide ou inactif' || error.message === 'Stock initial invalide') {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      loggerError('POST /api/produits', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async update(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const produit = await produitService.update(parseInt(req.params.id), {
        ...req.body,
        modifie_par: authReq.user?.id,
      });

      if (!produit) {
        res.status(404).json({ success: false, error: 'Produit non trouvé' });
        return;
      }

      await logAudit({
        utilisateur_id: authReq.user?.id || null,
        action: 'update',
        table_name: 'produits',
        record_id: produit.id,
        req,
        new_values: req.body,
      });

      res.json(successResponse(produit, 'Produit modifié'));
    } catch (error: any) {
      if (error.message === 'Aucun champ à mettre à jour') {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      loggerError('PUT /api/produits/:id', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const deleted = await produitService.softDelete(id);

      if (!deleted) {
        res.status(404).json({ success: false, error: 'Produit non trouvé' });
        return;
      }

      await logAudit({
        utilisateur_id: (req as AuthRequest).user?.id || null,
        action: 'delete',
        table_name: 'produits',
        record_id: id,
        req,
      });

      res.json(successResponse(null, 'Produit supprimé'));
    } catch (error: any) {
      if (error.code === '23503') {
        res.status(400).json({ success: false, error: 'Ce produit est lié à des factures' });
        return;
      }
      loggerError('DELETE /api/produits/:id', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async adjustStock(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const { quantite, location_id } = req.body;
      const result = await produitService.adjustStock(id, quantite, location_id);

      if (!result) {
        res.status(404).json({ success: false, error: 'Produit non trouvé' });
        return;
      }

      await logAudit({
        utilisateur_id: (req as AuthRequest).user?.id || null,
        action: 'update',
        table_name: 'produits',
        record_id: id,
        req,
        new_values: { stock: result.stock, quantite, location_id: location_id || null },
      });

      res.json(successResponse(result, 'Stock mis à jour'));
    } catch (error: any) {
      if (error.message === 'Depot invalide ou inactif' || error.message.startsWith('Stock insuffisant')) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      loggerError('PATCH /api/produits/:id/stock', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getStockValuation(req: Request, res: Response): Promise<void> {
    try {
      const data = await produitService.getStockValuation();
      res.json(successResponse(data));
    } catch (error) {
      loggerError('GET /api/produits/stock-valuation', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getStockByCategory(req: Request, res: Response): Promise<void> {
    try {
      const data = await produitService.getStockByCategory();
      res.json(successResponse(data));
    } catch (error) {
      loggerError('GET /api/produits/stock-by-category', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getAlertesStock(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePagination(req.query);
      const result = await produitService.getAll(undefined, undefined, true, { page, limit, sort: 'p.nom', order: 'ASC' });
      res.json(result);
    } catch (error) {
      loggerError('GET /api/produits/alertes-stock', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getStockHistory(req: Request, res: Response): Promise<void> {
    try {
      const data = await produitService.getStockHistory(parseInt(req.params.id), parseInt(req.query.limit as string) || 50);
      res.json(successResponse(data));
    } catch (error) {
      loggerError('GET /api/produits/:id/mouvements', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async addStockMovement(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const { type_mouvement, quantite, raison, reference_liee } = req.body;
      const result = await produitService.addStockMovement(id, type_mouvement, quantite, raison, reference_liee);

      if (!result) {
        res.status(404).json({ success: false, error: 'Produit non trouvé' });
        return;
      }

      await logAudit({
        utilisateur_id: (req as AuthRequest).user?.id || null,
        action: 'update',
        table_name: 'produits',
        record_id: id,
        req,
        new_values: { type_mouvement, quantite },
      });

      res.status(201).json(successResponse(result, 'Mouvement enregistré'));
    } catch (error) {
      loggerError('POST /api/produits/:id/mouvements', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  /**
   * GET /api/produits/search/fuzzy
   * Fuzzy search with similarity scoring
   */
  static async searchFuzzy(req: Request, res: Response): Promise<void> {
    try {
      const { q, limit, threshold } = req.query;
      const results = await produitService.searchFuzzy(
        q as string,
        limit ? parseInt(limit as string, 10) : 10,
        threshold ? parseFloat(threshold as string) : 0.1
      );
      res.json(successResponse(results));
    } catch (error) {
      loggerError('GET /api/produits/search/fuzzy', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  /**
   * GET /api/produits/suggestions
   * Quick autocomplete suggestions
   */
  static async getSuggestions(req: Request, res: Response): Promise<void> {
    try {
      const { q, limit } = req.query;
      const results = await produitService.getSuggestions(
        q as string,
        limit ? parseInt(limit as string, 10) : 5
      );
      res.json(successResponse(results));
    } catch (error) {
      loggerError('GET /api/produits/suggestions', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
}

function loggerError(context: string, error: any) {
  console.error(`Erreur ${context}:`, error);
}

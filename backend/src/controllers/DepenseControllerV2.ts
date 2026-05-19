import { Request, Response } from 'express';
import { depenseServiceV2 } from '../services/DepenseServiceV2';
import { depenseService } from '../services/DepenseService';
import { AuthRequest } from '../middleware/auth';

export class DepenseControllerV2 {
  /**
   * Get all expenses with filters
   * GET /api/depenses
   */
  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const { 
        magasin_id, categorie_id, methode_paiement,
        date_debut, date_fin, search,
        page, limit 
      } = req.query;

      // Check permission for specific magasin
      if (magasin_id) {
        const canAccess = await depenseServiceV2.canAccessMagasin(
          authReq.user!.id,
          authReq.user!.role,
          parseInt(magasin_id as string)
        );
        if (!canAccess) {
          res.status(403).json({ error: 'Accès refusé pour ce magasin' });
          return;
        }
      }

      const result = await depenseServiceV2.getAll({
        magasin_id: magasin_id ? parseInt(magasin_id as string) : undefined,
        categorie_id: categorie_id ? parseInt(categorie_id as string) : undefined,
        methode_paiement: methode_paiement as string,
        date_debut: date_debut as string,
        date_fin: date_fin as string,
        search: search as string,
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20
      });

      res.json({
        success: true,
        ...result
      });
    } catch (error: any) {
      console.error('Erreur GET /api/depenses:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Get expense by ID
   * GET /api/depenses/:id
   */
  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const id = parseInt(req.params.id);

      const depense = await depenseServiceV2.getById(id);

      if (!depense) {
        res.status(404).json({ error: 'Dépense non trouvée' });
        return;
      }

      // Check permission
      const canAccess = await depenseServiceV2.canAccessMagasin(
        authReq.user!.id,
        authReq.user!.role,
        depense.magasin_id
      );
      if (!canAccess) {
        res.status(403).json({ error: 'Accès refusé' });
        return;
      }

      res.json({
        success: true,
        data: depense
      });
    } catch (error: any) {
      console.error('Erreur GET /api/depenses/:id:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Create new expense
   * POST /api/depenses
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const {
        magasin_id, categorie_id, montant, methode_paiement,
        date_depense, description, beneficiaire_libre,
        fournisseur_id, justificatif_url
      } = req.body;

      // Validation
      if (!magasin_id || !categorie_id || !montant || !methode_paiement || !description) {
        res.status(400).json({ 
          error: 'Champs requis: magasin_id, categorie_id, montant, methode_paiement, description' 
        });
        return;
      }

      // Check permission
      const canAccess = await depenseServiceV2.canAccessMagasin(
        authReq.user!.id,
        authReq.user!.role,
        parseInt(magasin_id)
      );
      if (!canAccess) {
        res.status(403).json({ error: 'Accès refusé pour ce magasin' });
        return;
      }

      const result = await depenseServiceV2.create({
        magasin_id: parseInt(magasin_id),
        categorie_id: parseInt(categorie_id),
        montant: parseFloat(montant),
        methode_paiement,
        date_depense,
        description,
        beneficiaire_libre,
        fournisseur_id: fournisseur_id ? parseInt(fournisseur_id) : undefined,
        justificatif_url,
        cree_par: authReq.user!.id,
        req
      });

      res.status(201).json({
        success: true,
        data: result,
        message: 'Dépense créée avec succès'
      });
    } catch (error: any) {
      console.error('Erreur POST /api/depenses:', error);
      
      // Special handling for "Caisse fermée" error
      if (error.message.includes('Caisse fermée')) {
        res.status(422).json({ 
          error: error.message,
          code: 'CAISSE_FERMEE',
          action_required: 'OPEN_CAISSE'
        });
        return;
      }
      
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Update expense
   * PUT /api/depenses/:id
   */
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const id = parseInt(req.params.id);
      const updateData = req.body;

      const result = await depenseServiceV2.update(id, updateData, authReq.user!.id, authReq.user!.role);

      res.json({
        success: true,
        data: result,
        message: 'Dépense mise à jour'
      });
    } catch (error: any) {
      console.error('Erreur PUT /api/depenses:', error);
      
      if (error.message.includes('session clôturée')) {
        res.status(422).json({ error: error.message, code: 'SESSION_CLOTUREE' });
        return;
      }
      if (error.message.includes('Accès refusé')) {
        res.status(403).json({ error: error.message });
        return;
      }
      if (error.message.includes('Caisse fermée')) {
        res.status(422).json({ 
          error: error.message,
          code: 'CAISSE_FERMEE'
        });
        return;
      }
      
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Delete expense
   * DELETE /api/depenses/:id
   */
  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const id = parseInt(req.params.id);

      await depenseServiceV2.delete(id, authReq.user!.id, authReq.user!.role, req);

      res.json({
        success: true,
        message: 'Dépense supprimée'
      });
    } catch (error: any) {
      console.error('Erreur DELETE /api/depenses:', error);
      
      if (error.message.includes('session clôturée')) {
        res.status(422).json({ error: error.message, code: 'SESSION_CLOTUREE' });
        return;
      }
      if (error.message.includes('Accès refusé')) {
        res.status(403).json({ error: error.message });
        return;
      }
      
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Get expense categories
   * GET /api/depenses/categories/list
   */
  static async getCategories(req: Request, res: Response): Promise<void> {
    try {
      const categories = await depenseService.getCategories();
      res.json({ success: true, data: categories });
    } catch (error: any) {
      console.error('Erreur GET /api/depenses/categories:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Get reports by location
   * GET /api/depenses/reports/by-location
   */
  static async reportByLocation(req: Request, res: Response): Promise<void> {
    try {
      const { date_debut, date_fin } = req.query;
      const report = await depenseService.getReportByLocation(
        date_debut as string,
        date_fin as string
      );
      res.json({ success: true, data: report });
    } catch (error: any) {
      console.error('Erreur GET /api/depenses/reports/by-location:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Get reports by category
   * GET /api/depenses/reports/by-categorie
   */
  static async reportByCategorie(req: Request, res: Response): Promise<void> {
    try {
      const { date_debut, date_fin } = req.query;
      const report = await depenseService.getReportByCategorie(
        date_debut as string,
        date_fin as string
      );
      res.json({ success: true, data: report });
    } catch (error: any) {
      console.error('Erreur GET /api/depenses/reports/by-categorie:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

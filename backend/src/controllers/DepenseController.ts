import { Request, Response } from 'express';
import { DepenseService } from '../services/DepenseService';
import { AuthRequest } from '../middleware/auth';

const depenseService = new DepenseService();

export class DepenseController {

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, location_id, categorie_id, date_debut, date_fin, methode_paiement, page, limit, sort, order } = req.query;
      const result = await depenseService.getAll(
        search as string,
        location_id ? parseInt(location_id as string) : undefined,
        categorie_id ? parseInt(categorie_id as string) : undefined,
        date_debut as string,
        date_fin as string,
        methode_paiement as string,
        page ? parseInt(page as string) : 1,
        limit ? parseInt(limit as string) : 20,
        (sort as string) || 'date_depense',
        (order as string) || 'DESC'
      );
      res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const depense = await depenseService.getById(parseInt(req.params.id));
      if (!depense) {
        res.status(404).json({ success: false, error: 'Dépense non trouvée' });
        return;
      }
      res.json({ success: true, data: depense });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { location_id, session_caisse_id, categorie_id, fournisseur_id, montant, methode_paiement, date_depense, description, justificatif_url } = req.body;
      
      if (!categorie_id || !montant || !methode_paiement || !description) {
        res.status(400).json({ success: false, error: 'categorie_id, montant, methode_paiement, and description are required' });
        return;
      }

      const result = await depenseService.create({
        location_id,
        session_caisse_id,
        categorie_id,
        fournisseur_id,
        montant,
        methode_paiement,
        date_depense,
        description,
        justificatif_url,
        cree_par: req.user?.id,
        req,
      });

      res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await depenseService.update(parseInt(req.params.id), req.body, req);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      await depenseService.delete(parseInt(req.params.id), req);
      res.json({ success: true, message: 'Dépense supprimée' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getCategories(req: Request, res: Response): Promise<void> {
    try {
      const categories = await depenseService.getCategories();
      res.json({ success: true, data: categories });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async reportByLocation(req: Request, res: Response): Promise<void> {
    try {
      const { date_debut, date_fin } = req.query;
      const report = await depenseService.getReportByLocation(
        date_debut as string,
        date_fin as string
      );
      res.json({ success: true, data: report });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async reportByCategorie(req: Request, res: Response): Promise<void> {
    try {
      const { date_debut, date_fin } = req.query;
      const report = await depenseService.getReportByCategorie(
        date_debut as string,
        date_fin as string
      );
      res.json({ success: true, data: report });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

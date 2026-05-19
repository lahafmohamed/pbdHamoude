import { Request, Response } from 'express';
import { CaisseHierarchyService } from '../services/CaisseHierarchyService';
import { AuthRequest } from '../middleware/auth';

const caisseService = new CaisseHierarchyService();

export class CaisseHierarchyController {

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const caisses = await caisseService.getAll();
      res.json({ success: true, data: caisses });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const caisse = await caisseService.getById(parseInt(req.params.id));
      if (!caisse) {
        res.status(404).json({ success: false, error: 'Caisse non trouvée' });
        return;
      }
      res.json({ success: true, data: caisse });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getPrincipale(req: Request, res: Response): Promise<void> {
    try {
      const caisse = await caisseService.getCaissePrincipale();
      res.json({ success: true, data: caisse });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getMagasinCaisses(req: Request, res: Response): Promise<void> {
    try {
      const caisses = await caisseService.getMagasinCaisses();
      res.json({ success: true, data: caisses });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { code, nom, type, location_id, caisse_parent_id } = req.body;
      
      if (!code || !nom || !type) {
        res.status(400).json({ success: false, error: 'code, nom, and type are required' });
        return;
      }

      const result = await caisseService.create({ code, nom, type, location_id, caisse_parent_id }, req);
      res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await caisseService.update(parseInt(req.params.id), req.body, req);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async deactivate(req: AuthRequest, res: Response): Promise<void> {
    try {
      await caisseService.deactivate(parseInt(req.params.id), req);
      res.json({ success: true, message: 'Caisse désactivée' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async transfererFonds(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { caisse_source_id, caisse_dest_id, montant, notes } = req.body;
      
      if (!caisse_source_id || !caisse_dest_id || !montant) {
        res.status(400).json({ success: false, error: 'caisse_source_id, caisse_dest_id, and montant are required' });
        return;
      }

      const result = await caisseService.transfererFonds({
        caisse_source_id,
        caisse_dest_id,
        montant,
        notes,
        cree_par: req.user!.id,
        req,
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getTransferts(req: Request, res: Response): Promise<void> {
    try {
      const { caisse_id, statut, page, limit } = req.query;
      const result = await caisseService.getTransferts(
        caisse_id ? parseInt(caisse_id as string) : undefined,
        statut as string,
        page ? parseInt(page as string) : 1,
        limit ? parseInt(limit as string) : 20
      );
      res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getConsolidatedReport(req: Request, res: Response): Promise<void> {
    try {
      const report = await caisseService.getConsolidatedReport();
      res.json({ success: true, data: report });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getBalance(req: Request, res: Response): Promise<void> {
    try {
      const balance = await caisseService.getBalance(parseInt(req.params.id));
      if (!balance) {
        res.status(404).json({ success: false, error: 'Caisse non trouvée' });
        return;
      }
      res.json({ success: true, data: balance });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

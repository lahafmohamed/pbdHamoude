import { Request, Response } from 'express';
import { camionService } from '../services/CamionService';
import { parsePagination } from '../utils/pagination';
import { AuthRequest } from '../middleware/auth';

export class CamionController {
  static async getAllCamions(req: Request, res: Response): Promise<void> {
    try {
      const { actif } = req.query;
      const { page, limit } = parsePagination(req.query);
      const result = await camionService.getAllCamions({
        actif: actif !== undefined ? actif === 'true' : undefined,
        page, limit,
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  static async getCamionById(req: Request, res: Response): Promise<void> {
    try {
      const camion = await camionService.getCamionById(parseInt(req.params.id));
      if (!camion) { res.status(404).json({ error: 'Camion non trouvé' }); return; }
      res.json(camion);
    } catch (error) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  static async createCamion(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const result = await camionService.createCamion({ ...req.body, cree_par: authReq.user?.id, req });
      res.status(201).json(result);
    } catch (error: any) {
      if (error?.code === '23505') {
        res.status(409).json({ error: 'Plaque ou code déjà existant' });
      } else {
        res.status(500).json({ error: 'Erreur serveur' });
      }
    }
  }

  static async updateCamion(req: Request, res: Response): Promise<void> {
    try {
      const updated = await camionService.updateCamion(parseInt(req.params.id), req.body);
      if (!updated) { res.status(404).json({ error: 'Camion non trouvé' }); return; }
      res.json({ message: 'Camion mis à jour' });
    } catch (error: any) {
      if (error?.code === '23505') {
        res.status(409).json({ error: 'Plaque déjà utilisée' });
      } else {
        res.status(500).json({ error: 'Erreur serveur' });
      }
    }
  }

  static async desactiverCamion(req: Request, res: Response): Promise<void> {
    try {
      const ok = await camionService.desactiverCamion(parseInt(req.params.id));
      if (!ok) { res.status(404).json({ error: 'Camion non trouvé' }); return; }
      res.json({ message: 'Camion désactivé' });
    } catch (error) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  static async getRavitaillements(req: Request, res: Response): Promise<void> {
    try {
      const camionId = req.params.id ? parseInt(req.params.id) : undefined;
      const { page, limit } = parsePagination(req.query);
      const { date_debut, date_fin } = req.query as { date_debut?: string; date_fin?: string };
      const result = await camionService.getRavitaillements(camionId, { page, limit, date_debut, date_fin });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  static async getAllRavitaillements(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePagination(req.query);
      const { date_debut, date_fin } = req.query as { date_debut?: string; date_fin?: string };
      const result = await camionService.getRavitaillements(undefined, { page, limit, date_debut, date_fin });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  static async createRavitaillement(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const camion_id = req.params.id ? parseInt(req.params.id) : req.body.camion_id;
      if (!camion_id) { res.status(400).json({ error: 'camion_id requis' }); return; }
      const result = await camionService.createRavitaillement({ ...req.body, camion_id, cree_par: authReq.user?.id, req });
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
  }

  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      const camionId = req.params.id ? parseInt(req.params.id) : undefined;
      const stats = await camionService.getStats(camionId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

import { Request, Response } from 'express';
import { returnService } from '../services/ReturnService';
import { AuthRequest } from '../middleware/auth';

export class ReturnController {

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const data = await returnService.getAll(page, limit);
      res.json({ success: true, ...data });
    } catch (error) {
      consoleError('GET /api/retours', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const data = await returnService.getById(parseInt(req.params.id));
      if (!data) {
        res.status(404).json({ success: false, error: 'Retour non trouvé' });
        return;
      }
      res.json({ success: true, data });
    } catch (error) {
      consoleError('GET /api/retours/:id', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async create(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const result = await returnService.create({
        ...req.body,
        cree_par: authReq.user?.id,
        req,
      });
      res.status(201).json({ success: true, data: result, message: 'Retour créé et stock mis à jour' });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  static async updateStatut(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const updated = await returnService.updateStatut(
        parseInt(req.params.id),
        req.body.statut,
        authReq.user?.id,
        req
      );

      if (!updated) {
        res.status(404).json({ success: false, error: 'Retour non trouvé' });
        return;
      }

      res.json({ success: true, message: 'Statut mis à jour' });
    } catch (error) {
      consoleError('PUT /api/retours/:id/statut', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      const data = await returnService.getStats();
      res.json({ success: true, data });
    } catch (error) {
      consoleError('GET /api/retours/stats', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
}

function consoleError(context: string, error: any) {
  console.error(`Erreur ${context}:`, error);
}

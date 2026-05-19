import { Request, Response } from 'express';
import { receptionService } from '../services/ReceptionService';
import { AuthRequest } from '../middleware/auth';

export class ReceptionController {

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, page = '1', limit = '20' } = req.query;
      
      const pageNum = parseInt(page as string) || 1;
      const limitNum = parseInt(limit as string) || 20;
      
      const result = await receptionService.getAll({
        search: search as string,
        page: pageNum,
        limit: limitNum,
      });
      
      res.json({
        success: true,
        data: result.data,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: result.total,
          totalPages: Math.ceil(result.total / limitNum),
        }
      });
    } catch (error) {
      consoleError('GET /api/receptions', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const data = await receptionService.getById(parseInt(req.params.id));
      if (!data) {
        res.status(404).json({ success: false, error: 'Réception non trouvée' });
        return;
      }
      res.json({ success: true, data });
    } catch (error) {
      consoleError('GET /api/receptions/:id', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async create(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const result = await receptionService.create({
        ...req.body,
        receptionne_par: authReq.user?.id,
        req,
      });
      res.status(201).json({ success: true, data: result, message: 'Réception créée et stock mis à jour' });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const deleted = await receptionService.delete(
        parseInt(req.params.id),
        authReq.user?.id,
        req
      );

      if (!deleted) {
        res.status(404).json({ success: false, error: 'Réception non trouvée' });
        return;
      }

      res.json({ success: true, message: 'Réception supprimée et stock ajusté' });
    } catch (error) {
      consoleError('DELETE /api/receptions/:id', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getPendingOrders(req: Request, res: Response): Promise<void> {
    try {
      const data = await receptionService.getPendingOrders();
      res.json({ success: true, data });
    } catch (error) {
      consoleError('GET /api/receptions/pending', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getOrderDetails(req: Request, res: Response): Promise<void> {
    try {
      const data = await receptionService.getOrderDetails(parseInt(req.params.commandeId));
      if (!data) {
        res.status(404).json({ success: false, error: 'Commande non trouvée' });
        return;
      }
      res.json({ success: true, data });
    } catch (error) {
      consoleError('GET /api/receptions/order/:id', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      const data = await receptionService.getStats();
      res.json({ success: true, data });
    } catch (error) {
      consoleError('GET /api/receptions/stats', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
}

function consoleError(context: string, error: any) {
  console.error(`Erreur ${context}:`, error);
}

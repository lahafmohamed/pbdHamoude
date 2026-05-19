import { Request, Response } from 'express';
import { clientService } from '../services/ClientService';
import { AuthRequest } from '../middleware/auth';
import { logAudit } from '../middleware/audit';
import { parsePagination } from '../utils/pagination';
import { logger } from '../utils/logger';

export class ClientController {

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search } = req.query;
      const { page, limit, sort, order } = parsePagination(req.query, { sort: 'nom', order: 'ASC' });
      const result = await clientService.getAll(
        search as string,
        { page, limit, sort, order }
      );
      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error: any) {
      logger.error({ err: error }, 'GET /api/clients');
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const client = await clientService.findById(parseInt(req.params.id));
      if (!client) {
        res.status(404).json({ success: false, error: 'Client non trouvé' });
        return;
      }
      res.json({ success: true, data: client });
    } catch (error) {
      consoleError('GET /api/clients/:id', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getHistorique(req: Request, res: Response): Promise<void> {
    try {
      const data = await clientService.getHistorique(parseInt(req.params.id));
      res.json({ success: true, data });
    } catch (error) {
      consoleError('GET /api/clients/:id/historique', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async create(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const client = await clientService.create({
        ...req.body,
        cree_par: authReq.user?.id,
      });

      await logAudit({
        utilisateur_id: authReq.user?.id || null,
        action: 'create',
        table_name: 'clients',
        record_id: client.id,
        req,
        new_values: client,
      });

      res.status(201).json({ success: true, data: client, message: 'Client créé' });
    } catch (error) {
      consoleError('POST /api/clients', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async update(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const client = await clientService.update(parseInt(req.params.id), {
        ...req.body,
        modifie_par: authReq.user?.id,
      });

      if (!client) {
        res.status(404).json({ success: false, error: 'Client non trouvé' });
        return;
      }

      await logAudit({
        utilisateur_id: authReq.user?.id || null,
        action: 'update',
        table_name: 'clients',
        record_id: client.id,
        req,
        new_values: req.body,
      });

      res.json({ success: true, data: client, message: 'Client modifié' });
    } catch (error: any) {
      if (error.message === 'Aucun champ à mettre à jour') {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      consoleError('PUT /api/clients/:id', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const deleted = await clientService.softDelete(id);

      if (!deleted) {
        res.status(404).json({ success: false, error: 'Client non trouvé' });
        return;
      }

      await logAudit({
        utilisateur_id: (req as AuthRequest).user?.id || null,
        action: 'delete',
        table_name: 'clients',
        record_id: id,
        req,
      });

      res.json({ success: true, message: 'Client supprimé' });
    } catch (error: any) {
      if (error.code === '23503') {
        res.status(400).json({ success: false, error: 'Ce client est lié à des factures' });
        return;
      }
      consoleError('DELETE /api/clients/:id', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
}

function consoleError(context: string, error: any) {
  console.error(`Erreur ${context}:`, error);
}

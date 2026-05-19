import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { stockTransferService } from '../services/StockTransferService';
import { successResponse, paginatedResponse } from '../utils/response';

export class StockTransferController {
  /**
   * Get all stock transfers
   */
  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, statut, page, limit } = req.query;

      const transfers = await stockTransferService.getAll({
        search: search as string,
        statut: statut as string,
        page: parseInt(page as string) || 1,
        limit: parseInt(limit as string) || 20,
      });

      paginatedResponse(res, transfers.data, transfers.total, parseInt(page as string) || 1, parseInt(limit as string) || 20, 'Transferts récupérés avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get stock transfer by ID
   */
  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const transfer = await stockTransferService.getById(parseInt(id));

      if (!transfer) {
        res.status(404).json({ success: false, error: 'Transfert non trouvé' });
        return;
      }

      successResponse(res, transfer, 'Transfert récupéré avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Create stock transfer
   */
  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { location_source_id, location_destination_id, lignes, notes } = req.body;

      if (!location_source_id || !location_destination_id || !lignes || lignes.length === 0) {
        res.status(400).json({ success: false, error: 'Location source, destination et lignes sont requises' });
        return;
      }

      const transfer = await stockTransferService.create({
        location_source_id,
        location_destination_id,
        lignes,
        notes,
        cree_par: req.user?.id,
        req,
      });

      res.status(201).json({ success: true, data: transfer, message: 'Transfert créé avec succès' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Complete stock transfer
   */
  static async complete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      await stockTransferService.complete(parseInt(id), req.user?.id, req);

      successResponse(res, null, 'Transfert complété avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

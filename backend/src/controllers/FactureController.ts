import { Request, Response } from 'express';
import { factureService } from '../services/FactureService';
import { PaiementController } from './PaiementController';
import { AuthRequest } from '../middleware/auth';
import { parsePagination } from '../utils/pagination';
import { pdfService } from '../services/PDFService';

export class FactureController {

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, statut } = req.query;
      const { page, limit, sort, order } = parsePagination(req.query, { sort: 'date_facture', order: 'DESC' });
      const result = await factureService.getAll(
        search as string,
        statut as string,
        page,
        limit,
        sort,
        order
      );
      res.json({ success: true, ...result });
    } catch (error) {
      consoleError('GET /api/factures', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const facture = await factureService.getById(parseInt(req.params.id));
      if (!facture) {
        res.status(404).json({ success: false, error: 'Facture non trouvée' });
        return;
      }
      res.json({ success: true, data: facture });
    } catch (error) {
      consoleError('GET /api/factures/:id', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async create(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const result = await factureService.create({
        ...req.body,
        cree_par: authReq.user?.id,
        req,
      });
      res.status(201).json({ success: true, data: result, message: 'Facture créée et stock mis à jour' });
    } catch (error: any) {
      const status = typeof error?.statusCode === 'number' ? error.statusCode : 400;
      const payload: any = { success: false, error: error.message };
      if (Array.isArray(error?.offending_lines)) {
        payload.offending_lines = error.offending_lines;
      }
      res.status(status).json(payload);
    }
  }

  static async updateStatut(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const updated = await factureService.updateStatut(
        parseInt(req.params.id),
        req.body.statut,
        authReq.user?.id,
        req
      );

      if (!updated) {
        res.status(404).json({ success: false, error: 'Facture non trouvée' });
        return;
      }

      res.json({ success: true, message: 'Statut mis à jour' });
    } catch (error) {
      consoleError('PUT /api/factures/:id/statut', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const { restaurer_stock }: { restaurer_stock?: boolean } = req.body;
      const deleted = await factureService.delete(
        parseInt(req.params.id),
        restaurer_stock,
        authReq.user?.id,
        req
      );

      if (!deleted) {
        res.status(404).json({ success: false, error: 'Facture non trouvée' });
        return;
      }

      res.json({ success: true, message: restaurer_stock ? 'Facture supprimée et stock restauré' : 'Facture supprimée' });
    } catch (error) {
      consoleError('DELETE /api/factures/:id', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await factureService.getStats();
      const produitService = await import('../services/ProduitService');
      const lowStockCount = await produitService.produitService.getLowStockCount();
      res.json({ success: true, data: { ...stats, alertes_stock: lowStockCount } });
    } catch (error) {
      consoleError('GET /api/factures/stats', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getRevenueTrends(req: Request, res: Response): Promise<void> {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const data = await factureService.getRevenueTrends(days);
      res.json({ success: true, data });
    } catch (error) {
      consoleError('GET /api/factures/revenue-trends', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getTopProducts(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const data = await factureService.getTopProducts(limit);
      res.json({ success: true, data });
    } catch (error) {
      consoleError('GET /api/factures/top-products', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async getTopClients(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const data = await factureService.getTopClients(limit);
      res.json({ success: true, data });
    } catch (error) {
      consoleError('GET /api/factures/top-clients', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  static async generatePDF(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const buffer = await pdfService.generateInvoicePDF(parseInt(id));
      const facture = await factureService.getById(parseInt(id));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="facture-${facture?.numero_facture || id}.pdf"`);
      res.send(buffer);
    } catch (error) {
      consoleError('GET /api/factures/:id/pdf', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
}

function consoleError(context: string, error: any) {
  console.error(`Erreur ${context}:`, error);
}

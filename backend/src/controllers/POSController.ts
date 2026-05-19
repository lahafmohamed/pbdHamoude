import { Request, Response } from 'express';
import { posService } from '../services/POSService';
import { AuthRequest } from '../middleware/auth';

export class POSController {
  /**
   * Open POS session
   */
  static async openSession(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const { solde_ouverture, location_id } = req.body;

      const session = await posService.openSession(authReq.user!.id, solde_ouverture || 0, location_id);
      res.status(201).json({ success: true, data: session });
    } catch (error: any) {
      console.error('Erreur POST /api/pos/open:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Get current session
   */
  static async getCurrentSession(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const session = await posService.getCurrentSession(authReq.user!.id);

      res.json({ success: true, data: session });
    } catch (error: any) {
      console.error('Erreur GET /api/pos/session:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Scan barcode
   */
  static async scanBarcode(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const { code_barre } = req.query;

      if (!code_barre) {
        res.status(400).json({ error: 'Code barre requis' });
        return;
      }

      const produit = await posService.scanBarcode(code_barre as string, authReq.user!.id);

      if (!produit) {
        res.json({ success: true, data: null, message: 'Produit non trouvé' });
        return;
      }

      res.json({ success: true, data: produit });
    } catch (error: any) {
      console.error('Erreur GET /api/pos/scan:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Process quick sale
   */
  static async processQuickSale(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const { sessionId, items, client_id, methode_paiement } = req.body;

      if (!sessionId || !items || items.length === 0) {
        res.status(400).json({ error: 'Session ID et articles requis' });
        return;
      }

      const result = await posService.processQuickSale(
        sessionId,
        items,
        client_id,
        methode_paiement || 'espece',
        authReq.user!.id
      );

      res.status(201).json({
        success: true,
        data: result,
        message: 'Vente traitée avec succès'
      });
    } catch (error: any) {
      console.error('Erreur POST /api/pos/sale:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Close POS session
   */
  static async closeSession(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;

      const session = await posService.closeSession(parseInt(sessionId));
      res.json({ success: true, data: session });
    } catch (error: any) {
      console.error('Erreur POST /api/pos/close:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Get session summary
   */
  static async getSessionSummary(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;

      const summary = await posService.getSessionSummary(parseInt(sessionId));
      res.json({ success: true, data: summary });
    } catch (error: any) {
      console.error('Erreur GET /api/pos/summary:', error);
      res.status(400).json({ error: error.message });
    }
  }
}

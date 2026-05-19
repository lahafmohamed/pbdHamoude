import { Request, Response } from 'express';
import { caisseService } from '../services/CaisseService';
import { AuthRequest } from '../middleware/auth';

export class CaisseController {
  /**
   * Open a new cash register session
   */
  static async openSession(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const { solde_ouverture, notes } = req.body;

      if (solde_ouverture === undefined || solde_ouverture === null) {
        res.status(400).json({ error: 'Le solde d\'ouverture est requis' });
        return;
      }

      const session = await caisseService.openSession(authReq.user!.id, solde_ouverture, notes);
      res.status(201).json({
        success: true,
        data: session,
        message: 'Session de caisse ouverte'
      });
    } catch (error: any) {
      console.error('Erreur POST /api/caisse/open:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Close current session
   */
  static async closeSession(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const { solde_fermeture, notes } = req.body;

      if (solde_fermeture === undefined || solde_fermeture === null) {
        res.status(400).json({ error: 'Le solde de fermeture est requis' });
        return;
      }

      const result = await caisseService.closeSession(parseInt(sessionId), solde_fermeture, notes);
      res.json({
        success: true,
        data: result,
        message: result.message
      });
    } catch (error: any) {
      console.error('Erreur POST /api/caisse/:sessionId/close:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Get current open session
   */
  static async getCurrentSession(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const session = await caisseService.getCurrentSession(authReq.user!.id);
      
      if (!session) {
        res.json({ success: true, data: null, message: 'Aucune session ouverte' });
        return;
      }

      res.json({ success: true, data: session });
    } catch (error: any) {
      console.error('Erreur GET /api/caisse/current:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Get Z report for a session
   */
  static async getZReport(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const report = await caisseService.getSessionZReport(parseInt(sessionId));
      res.json({ success: true, data: report });
    } catch (error: any) {
      console.error('Erreur GET /api/caisse/:sessionId/report:', error);
      if (error.message === 'Session non trouvée') {
        res.status(404).json({ error: 'Session non trouvée' });
        return;
      }
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * List sessions
   */
  static async getSessions(req: Request, res: Response): Promise<void> {
    try {
      const { page = 1, limit = 20, utilisateur_id, statut } = req.query;
      const result = await caisseService.getSessions(
        parseInt(page as string),
        parseInt(limit as string),
        utilisateur_id ? parseInt(utilisateur_id as string) : undefined,
        statut as string
      );
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('Erreur GET /api/caisse/sessions:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

/**
    * Record a cash movement
    */
  static async recordMovement(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const { sessionId } = req.params;
      const movementData = req.body;

      const movement = await caisseService.recordMovement(parseInt(sessionId), {
        ...movementData,
        cree_par: authReq.user!.id
      });

      res.status(201).json({
        success: true,
        data: movement,
        message: 'Mouvement enregistré'
      });
    } catch (error: any) {
      console.error('Erreur POST /api/caisse/:sessionId/movements:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Get payments for a session
   */
  static async getSessionPaiements(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const paiements = await caisseService.getSessionPaiements(parseInt(sessionId));
      res.json({ success: true, data: paiements });
    } catch (error: any) {
      console.error('Erreur GET /api/caisse/:sessionId/paiements:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

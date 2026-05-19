import { Request, Response } from 'express';
import { caisseMagasinService } from '../services/CaisseMagasinService';
import { AuthRequest } from '../middleware/auth';
import pool from '../db/connection';

export class CaisseMagasinController {
  /**
   * Get active session for a magasin
   * GET /api/caisse/session-active?magasin_id=X
   */
  static async getSessionActive(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const magasinId = parseInt(req.query.magasin_id as string);

      if (!magasinId) {
        res.status(400).json({ error: 'magasin_id requis' });
        return;
      }

      // Check permission
      const userRole = await caisseMagasinService.getUserMagasinRole(authReq.user!.id, magasinId);
      if (userRole === 'none') {
        res.status(403).json({ error: 'Accès refusé - vous ne pouvez pas voir cette caisse' });
        return;
      }

      const session = await caisseMagasinService.getSessionActive(magasinId);

      res.json({
        success: true,
        data: session,
        message: session ? 'Session active trouvée' : 'Aucune session ouverte pour ce magasin'
      });
    } catch (error: any) {
      console.error('Erreur GET /api/caisse/session-active:', error);
      res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
  }

  /**
   * Open a new cash session
   * POST /api/caisse/ouvrir
   */
  static async ouvrirSession(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const { magasin_id, fond_initial, commentaire_ouverture } = req.body;

      if (!magasin_id || fond_initial === undefined || fond_initial === null) {
        res.status(400).json({ error: 'magasin_id et fond_initial requis' });
        return;
      }

      const session = await caisseMagasinService.ouvrirSession({
        magasin_id: parseInt(magasin_id),
        fond_initial: parseFloat(fond_initial),
        commentaire_ouverture,
        user_id: authReq.user!.id
      });

      res.status(201).json({
        success: true,
        data: session,
        message: 'Caisse ouverte avec succès'
      });
    } catch (error: any) {
      console.error('Erreur POST /api/caisse/ouvrir:', error);
      if (error.message.includes('déjà ouverte')) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.message.includes('Accès refusé')) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Close a cash session
   * POST /api/caisse/cloturer/:session_id
   */
  static async cloturerSession(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const sessionId = parseInt(req.params.session_id);
      const { fond_final_compte, commentaire_cloture } = req.body;

      if (!sessionId || fond_final_compte === undefined || fond_final_compte === null) {
        res.status(400).json({ error: 'session_id et fond_final_compte requis' });
        return;
      }

      const result = await caisseMagasinService.cloturerSession({
        session_id: sessionId,
        fond_final_compte: parseFloat(fond_final_compte),
        commentaire_cloture,
        user_id: authReq.user!.id
      });

      res.json({
        success: true,
        data: result,
        message: result.message
      });
    } catch (error: any) {
      console.error('Erreur POST /api/caisse/cloturer:', error);
      if (error.message.includes('commentaire est obligatoire')) {
        res.status(422).json({ error: error.message, code: 'ECART_COMMENT_REQUIRED' });
        return;
      }
      if (error.message.includes('Accès refusé')) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Get session details with movements
   * GET /api/caisse/session/:session_id
   */
  static async getSessionDetail(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const sessionId = parseInt(req.params.session_id);

      if (!sessionId) {
        res.status(400).json({ error: 'session_id requis' });
        return;
      }

      const session = await caisseMagasinService.getSessionDetail(sessionId);

      // Check permission
      const userRole = await caisseMagasinService.getUserMagasinRole(authReq.user!.id, session.magasin_id);
      if (userRole === 'none') {
        res.status(403).json({ error: 'Accès refusé' });
        return;
      }

      res.json({
        success: true,
        data: session
      });
    } catch (error: any) {
      console.error('Erreur GET /api/caisse/session:', error);
      if (error.message === 'Session non trouvée') {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Get historique des sessions
   * GET /api/caisse/historique?magasin_id=X&from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  static async getHistorique(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const { magasin_id, from, to, page, limit } = req.query;

      // If magasin_id specified, check permission
      if (magasin_id) {
        const userRole = await caisseMagasinService.getUserMagasinRole(
          authReq.user!.id, 
          parseInt(magasin_id as string)
        );
        if (userRole === 'none') {
          res.status(403).json({ error: 'Accès refusé' });
          return;
        }
      }

      const result = await caisseMagasinService.getHistoriqueSessions(
        magasin_id ? parseInt(magasin_id as string) : undefined,
        from as string,
        to as string,
        page ? parseInt(page as string) : 1,
        limit ? parseInt(limit as string) : 20
      );

      res.json({
        success: true,
        ...result
      });
    } catch (error: any) {
      console.error('Erreur GET /api/caisse/historique:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Get list of magasins for current user
   * GET /api/caisse/magasins
   */
  static async getMagasins(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;

      const magasins = await caisseMagasinService.getMagasinsForUser(
        authReq.user!.id,
        authReq.user!.role
      );

      res.json({
        success: true,
        data: magasins
      });
    } catch (error: any) {
      console.error('Erreur GET /api/caisse/magasins:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Get mouvements for a session
   * GET /api/caisse/:session_id/mouvements
   */
  /**
   * Cloture preview: shows expected_cash, per-method totals, orphans.
   * GET /api/caisse/cloture-preview/:session_id?fond_final_compte=X
   */
  static async getCloturePreview(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const sessionId = parseInt(req.params.session_id);
      const fondFinal = req.query.fond_final_compte !== undefined
        ? parseFloat(req.query.fond_final_compte as string)
        : undefined;

      if (!sessionId) {
        res.status(400).json({ error: 'session_id requis' });
        return;
      }

      const preview = await caisseMagasinService.getCloturePreview(sessionId, fondFinal);

      const userRole = await caisseMagasinService.getUserMagasinRole(authReq.user!.id, preview.magasin_id);
      if (userRole === 'none') {
        res.status(403).json({ error: 'Accès refusé' });
        return;
      }

      res.json({ success: true, data: preview });
    } catch (error: any) {
      console.error('Erreur GET /api/caisse/cloture-preview:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Record a "divers" cash movement (apport, retrait_banque, autre_entree, autre_sortie).
   * These are the only categories allowed without a source-record link;
   * libelle (reason) is mandatory.
   * POST /api/caisse/:session_id/mouvement-divers
   */
  static async recordMouvementDivers(req: Request, res: Response): Promise<void> {
    const dbClient = await pool.connect();
    try {
      const authReq = req as AuthRequest;
      const sessionId = parseInt(req.params.session_id);
      const { type, categorie, montant, methode_paiement, libelle, idempotency_key } = req.body;

      const ALLOWED_CATEGORIES = ['apport', 'retrait_banque', 'autre_entree', 'autre_sortie'];
      const VALID_METHODS = ['espece','carte','cheque','virement','mobile_money','orange_money','mtn_money','wave'];

      if (!sessionId) {
        res.status(400).json({ error: 'session_id requis' });
        return;
      }
      if (!['encaissement', 'decaissement'].includes(type)) {
        res.status(400).json({ error: 'type invalide (encaissement|decaissement)' });
        return;
      }
      if (!ALLOWED_CATEGORIES.includes(categorie)) {
        res.status(400).json({ error: `categorie doit être l'une de: ${ALLOWED_CATEGORIES.join(', ')}` });
        return;
      }
      if (!methode_paiement || !VALID_METHODS.includes(methode_paiement)) {
        res.status(400).json({ error: 'methode_paiement invalide' });
        return;
      }
      if (!libelle || libelle.trim().length < 3) {
        res.status(400).json({ error: 'libelle (motif) obligatoire (≥3 caractères)' });
        return;
      }
      if (!montant || Number(montant) <= 0) {
        res.status(400).json({ error: 'montant > 0 obligatoire' });
        return;
      }

      // Permission check
      const { rows: sessRows } = await dbClient.query(
        'SELECT magasin_id FROM sessions_caisse WHERE id = $1',
        [sessionId]
      );
      if (sessRows.length === 0) {
        res.status(404).json({ error: 'Session introuvable' });
        return;
      }
      const userRole = await caisseMagasinService.getUserMagasinRole(authReq.user!.id, sessRows[0].magasin_id);
      if (userRole === 'none') {
        res.status(403).json({ error: 'Accès refusé' });
        return;
      }

      await dbClient.query('BEGIN');
      const mouvement = await caisseMagasinService.enregistrerMouvement(dbClient, {
        session_caisse_id: sessionId,
        type,
        categorie,
        montant: Number(montant),
        methode_paiement,
        libelle: libelle.trim(),
        user_id: authReq.user!.id,
        idempotency_key,
      });
      await dbClient.query('COMMIT');

      res.status(201).json({ success: true, data: mouvement });
    } catch (error: any) {
      await dbClient.query('ROLLBACK');
      console.error('Erreur POST /api/caisse/:session_id/mouvement-divers:', error);
      res.status(400).json({ error: error.message });
    } finally {
      dbClient.release();
    }
  }

  static async getMouvements(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const sessionId = parseInt(req.params.session_id);

      if (!sessionId) {
        res.status(400).json({ error: 'session_id requis' });
        return;
      }

      // Get mouvements first
      const mouvements = await caisseMagasinService.getMouvementsSession(sessionId);
      
      if (mouvements.length === 0) {
        // Try to get session info to check permission
        const session = await caisseMagasinService.getSessionDetail(sessionId).catch(() => null);
        if (!session) {
          res.status(404).json({ error: 'Session non trouvée' });
          return;
        }
        
        const userRole = await caisseMagasinService.getUserMagasinRole(
          authReq.user!.id,
          session.magasin_id
        );
        if (userRole === 'none') {
          res.status(403).json({ error: 'Accès refusé' });
          return;
        }
        
        res.json({ success: true, data: [] });
        return;
      }

      // Get session from first mouvement
      const { rows: sessionRows } = await pool.query(
        'SELECT magasin_id FROM sessions_caisse WHERE id = $1',
        [sessionId]
      );

      if (sessionRows.length === 0) {
        res.status(404).json({ error: 'Session non trouvée' });
        return;
      }

      const userRole = await caisseMagasinService.getUserMagasinRole(
        authReq.user!.id,
        sessionRows[0].magasin_id
      );
      if (userRole === 'none') {
        res.status(403).json({ error: 'Accès refusé' });
        return;
      }

      res.json({
        success: true,
        data: mouvements
      });
    } catch (error: any) {
      console.error('Erreur GET /api/caisse/mouvements:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

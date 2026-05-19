/**
 * DEPRECATED – /api/comptes is a compatibility shim.
 * All new code should use /api/tiers/:id/acomptes-client and /api/tiers/:id/compte instead.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { TiersController } from '../controllers/TiersController';
import pool from '../db/connection';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

const deprecated = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', '</api/tiers>; rel="successor-version"');
  next();
};
router.use(deprecated);

// POST /api/comptes/:clientId/acomptes → POST /api/tiers/:id/acomptes-client
router.post('/:clientId/acomptes', (req: Request, res: Response) => {
  req.params.id = req.params.clientId;
  TiersController.recordAcompteClient(req, res);
});

// GET /api/comptes/:clientId/acomptes/disponibles → query tiers-based table
router.get('/:clientId/acomptes/disponibles', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ac.*, t.raison_sociale as client_nom, t.prenom as client_prenom
       FROM acomptes_clients ac
       INNER JOIN tiers t ON ac.tiers_id = t.id
       WHERE ac.tiers_id = $1 AND ac.statut = 'disponible'
       ORDER BY ac.date_acompte ASC`,
      [req.params.clientId]
    );
    res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error('Erreur GET /api/comptes/:id/acomptes/disponibles:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/comptes/:clientId/solde → GET /api/tiers/:id/compte
router.get('/:clientId/solde', (req: Request, res: Response) => {
  req.params.id = req.params.clientId;
  TiersController.getCompte(req, res);
});

// GET /api/comptes/:clientId/releve → GET /api/tiers/:id/compte
router.get('/:clientId/releve', (req: Request, res: Response) => {
  req.params.id = req.params.clientId;
  TiersController.getCompte(req, res);
});

// GET /api/comptes/:clientId/aging → GET /api/tiers/:id/compte (aging included)
router.get('/:clientId/aging', (req: Request, res: Response) => {
  req.params.id = req.params.clientId;
  TiersController.getCompte(req, res);
});

// POST /api/comptes/:clientId/apply-acompte → not directly mapped; return 410
router.post('/:clientId/apply-acompte', (_req: Request, res: Response) => {
  res.status(410).json({ success: false, error: 'Utiliser /api/tiers/:id/acomptes-client' });
});

// POST /api/comptes/:clientId/ledger → not directly mapped; return 410
router.post('/:clientId/ledger', (_req: Request, res: Response) => {
  res.status(410).json({ success: false, error: 'Utiliser /api/tiers/:id/compte' });
});

export default router;

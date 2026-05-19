import { Router } from 'express';
import { CaisseMagasinController } from '../controllers/CaisseMagasinController';
import pool from '../db/connection';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get magasins for current user
router.get('/magasins', CaisseMagasinController.getMagasins);

// Get active session for a magasin
router.get('/session-active', CaisseMagasinController.getSessionActive);

// Open new session
router.post('/ouvrir', authorize(['admin', 'manager', 'caissier', 'magasin_staff']), CaisseMagasinController.ouvrirSession);

// Close session
router.post('/cloturer/:session_id', authorize(['admin', 'manager', 'caissier', 'magasin_staff']), CaisseMagasinController.cloturerSession);

// Get session details with movements
router.get('/session/:session_id', CaisseMagasinController.getSessionDetail);

// Get movements for a session
router.get('/:session_id/mouvements', CaisseMagasinController.getMouvements);

// Get historique des sessions
router.get('/historique', CaisseMagasinController.getHistorique);

// Cloture preview (expected/counted/variance/orphans)
router.get('/cloture-preview/:session_id', CaisseMagasinController.getCloturePreview);

// Record a divers (no-source) movement: apport/retrait_banque/autre_*
router.post(
  '/:session_id/mouvement-divers',
  authorize(['admin', 'manager', 'caissier', 'magasin_staff']),
  CaisseMagasinController.recordMouvementDivers
);

// Audit: unified view of every money-event vs caisse link
router.get('/audit', authorize(['admin', 'manager']), async (req, res) => {
  try {
    const {
      orphans_only,
      source_kind,
      tiers_id,
      date_from,
      date_to,
      limit = '200',
    } = req.query as Record<string, string>;

    const where: string[] = [];
    const params: any[] = [];
    let p = 1;
    if (orphans_only === 'true') where.push('is_orphan = TRUE');
    if (source_kind) { where.push(`source_kind = $${p++}`); params.push(source_kind); }
    if (tiers_id) { where.push(`tiers_id = $${p++}`); params.push(parseInt(tiers_id)); }
    if (date_from) { where.push(`source_date >= $${p++}`); params.push(date_from); }
    if (date_to) { where.push(`source_date <= $${p++}`); params.push(date_to); }
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const lim = Math.min(parseInt(limit) || 200, 1000);

    const [{ rows: items }, { rows: summary }, { rows: orphCount }] = await Promise.all([
      pool.query(
        `SELECT * FROM v_caisse_audit ${whereSQL}
         ORDER BY source_date DESC LIMIT ${lim}`,
        params
      ),
      pool.query(
        `SELECT source_kind,
                COUNT(*) AS total,
                COALESCE(SUM(montant),0) AS total_montant,
                SUM(CASE WHEN is_orphan THEN 1 ELSE 0 END) AS orphans
         FROM v_caisse_audit
         GROUP BY source_kind
         ORDER BY source_kind`
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM v_caisse_audit WHERE is_orphan`),
    ]);

    res.json({
      success: true,
      data: items,
      summary,
      orphans_total: orphCount[0]?.n || 0,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

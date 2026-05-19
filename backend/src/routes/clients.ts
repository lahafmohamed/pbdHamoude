/**
 * DEPRECATED – /api/clients is a compatibility shim.
 * All new code should use /api/tiers?role=client instead.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { TiersController } from '../controllers/TiersController';
import { authenticate } from '../middleware/auth';
import pool from '../db/connection';

const router = Router();

router.use(authenticate);

const deprecated = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', '</api/tiers>; rel="successor-version"');
  next();
};
router.use(deprecated);

// GET /api/clients → GET /api/tiers?role=client
router.get('/', (req: Request, res: Response) => {
  req.query.role = 'client';
  TiersController.getAll(req, res);
});

// GET /api/clients/with-balance — list all clients with computed balance (tiers table)
router.get('/with-balance', async (req, res) => {
  try {
    const { search, sort = 'nom', order = 'asc', page = '1', limit = '20', statut_solde } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const offset = (pageNum - 1) * limitNum;
    const sortDir = (order as string).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const searchParam = search ? `%${search}%` : null;
    const statutParam = ['debiteur', 'crediteur', 'solde'].includes(statut_solde as string)
      ? (statut_solde as string)
      : null;

    const allowedSortCols = ['nom', 'prenom', 'solde', 'derniere_activite'];
    const sortCol = allowedSortCols.includes(sort as string) ? (sort as string) : 'nom';

    const dataQuery = `
      WITH balance_data AS (
        SELECT
          c.id, c.raison_sociale as nom, c.prenom, c.email, c.telephone, c.adresse, c.nif, c.created_at,
          COALESCE(f.total_factures, 0) as total_facture,
          COALESCE(p.total_paiements, 0) + COALESCE(ac.total_acomptes, 0) as total_paye,
          COALESCE(fa.total_avoirs, 0) as total_avoir,
          ROUND(COALESCE(f.total_factures, 0) - COALESCE(p.total_paiements, 0) - COALESCE(fa.total_avoirs, 0) - COALESCE(ac.total_acomptes, 0)) as solde,
          CASE
            WHEN COALESCE(f.total_factures, 0) - COALESCE(p.total_paiements, 0) - COALESCE(fa.total_avoirs, 0) - COALESCE(ac.total_acomptes, 0) > 0 THEN 'debiteur'
            WHEN COALESCE(f.total_factures, 0) - COALESCE(p.total_paiements, 0) - COALESCE(fa.total_avoirs, 0) - COALESCE(ac.total_acomptes, 0) < 0 THEN 'crediteur'
            ELSE 'solde'
          END as statut_solde,
          NULLIF(GREATEST(
            COALESCE(f.derniere_facture, '1970-01-01'::timestamp),
            COALESCE(p.dernier_paiement, '1970-01-01'::timestamp),
            COALESCE(fa.dernier_avoir::timestamp, '1970-01-01'::timestamp),
            COALESCE(ac.dernier_acompte, '1970-01-01'::timestamp)
          ), '1970-01-01'::timestamp) as derniere_activite
        FROM tiers c
        LEFT JOIN (
          SELECT tiers_id, SUM(total) as total_factures, MAX(date_facture) as derniere_facture
          FROM factures WHERE statut != 'annulee' AND deleted_at IS NULL GROUP BY tiers_id
        ) f ON f.tiers_id = c.id
        LEFT JOIN (
          SELECT f2.tiers_id, SUM(p.montant) as total_paiements, MAX(p.date_paiement) as dernier_paiement
          FROM paiements p
          JOIN factures f2 ON f2.id = p.facture_id
          WHERE f2.deleted_at IS NULL
          GROUP BY f2.tiers_id
        ) p ON p.tiers_id = c.id
        LEFT JOIN (
          SELECT tiers_id, SUM(total) as total_avoirs, MAX(date_avoir) as dernier_avoir
          FROM factures_avoir WHERE statut IN ('valide', 'utilise') GROUP BY tiers_id
        ) fa ON fa.tiers_id = c.id
        LEFT JOIN (
          SELECT tiers_id, SUM(montant) as total_acomptes, MAX(date_acompte) as dernier_acompte
          FROM acomptes_clients WHERE statut IN ('disponible', 'utilise') GROUP BY tiers_id
        ) ac ON ac.tiers_id = c.id
        WHERE c.deleted_at IS NULL AND c.est_client = true
          AND ($1::text IS NULL OR c.raison_sociale ILIKE $1 OR c.prenom ILIKE $1 OR c.email ILIKE $1)
      )
      SELECT * FROM balance_data
      WHERE ($2::text IS NULL OR statut_solde = $2)
      ORDER BY
        CASE WHEN $3 = 'nom'     AND $4 = 'ASC'  THEN nom END ASC NULLS LAST,
        CASE WHEN $3 = 'nom'     AND $4 = 'DESC' THEN nom END DESC NULLS LAST,
        CASE WHEN $3 = 'prenom'  AND $4 = 'ASC'  THEN prenom END ASC NULLS LAST,
        CASE WHEN $3 = 'prenom'  AND $4 = 'DESC' THEN prenom END DESC NULLS LAST,
        CASE WHEN $3 = 'solde'   AND $4 = 'ASC'  THEN solde END ASC NULLS LAST,
        CASE WHEN $3 = 'solde'   AND $4 = 'DESC' THEN solde END DESC NULLS LAST,
        CASE WHEN $3 = 'derniere_activite' AND $4 = 'ASC'  THEN derniere_activite END ASC NULLS LAST,
        CASE WHEN $3 = 'derniere_activite' AND $4 = 'DESC' THEN derniere_activite END DESC NULLS LAST,
        CASE WHEN $3 NOT IN ('nom','prenom','solde','derniere_activite') AND $4 = 'ASC'  THEN nom END ASC NULLS LAST,
        CASE WHEN $3 NOT IN ('nom','prenom','solde','derniere_activite') AND $4 = 'DESC' THEN nom END DESC NULLS LAST
      LIMIT $5 OFFSET $6
    `;

    const countQuery = `
      WITH balance_data AS (
        SELECT c.id,
          CASE
            WHEN COALESCE(f.total_factures, 0) - COALESCE(p.total_paiements, 0) - COALESCE(fa.total_avoirs, 0) - COALESCE(ac.total_acomptes, 0) > 0 THEN 'debiteur'
            WHEN COALESCE(f.total_factures, 0) - COALESCE(p.total_paiements, 0) - COALESCE(fa.total_avoirs, 0) - COALESCE(ac.total_acomptes, 0) < 0 THEN 'crediteur'
            ELSE 'solde'
          END as statut_solde
        FROM tiers c
        LEFT JOIN (SELECT tiers_id, SUM(total) as total_factures FROM factures WHERE statut != 'annulee' AND deleted_at IS NULL GROUP BY tiers_id) f ON f.tiers_id = c.id
        LEFT JOIN (SELECT f2.tiers_id, SUM(p.montant) as total_paiements FROM paiements p JOIN factures f2 ON f2.id = p.facture_id WHERE f2.deleted_at IS NULL GROUP BY f2.tiers_id) p ON p.tiers_id = c.id
        LEFT JOIN (SELECT tiers_id, SUM(total) as total_avoirs FROM factures_avoir WHERE statut IN ('valide','utilise') GROUP BY tiers_id) fa ON fa.tiers_id = c.id
        LEFT JOIN (SELECT tiers_id, SUM(montant) as total_acomptes FROM acomptes_clients WHERE statut IN ('disponible', 'utilise') GROUP BY tiers_id) ac ON ac.tiers_id = c.id
        WHERE c.deleted_at IS NULL AND c.est_client = true
          AND ($1::text IS NULL OR c.raison_sociale ILIKE $1 OR c.prenom ILIKE $1 OR c.email ILIKE $1)
      )
      SELECT COUNT(*) as total FROM balance_data
      WHERE ($2::text IS NULL OR statut_solde = $2)
    `;

    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, [searchParam, statutParam, sortCol, sortDir, limitNum, offset]),
      pool.query(countQuery, [searchParam, statutParam]),
    ]);

    const total = parseInt(countResult.rows[0]?.total || '0');

    res.json({
      success: true,
      data: dataResult.rows.map((row: any) => ({
        id: row.id,
        nom: row.raison_sociale,
        raison_sociale: row.raison_sociale,
        prenom: row.prenom,
        email: row.email,
        telephone: row.telephone,
        adresse: row.adresse,
        nif: row.nif,
        created_at: row.created_at,
        total_facture: parseFloat(row.total_facture),
        total_paye: parseFloat(row.total_paye),
        total_avoir: parseFloat(row.total_avoir),
        solde: parseInt(row.solde),
        statut_solde: row.statut_solde,
        derniere_activite: row.derniere_activite,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('GET /api/clients/with-balance error:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// GET /api/clients/:id/compte — per-client ledger with running balance
router.get('/:id/compte', async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    if (isNaN(clientId)) {
      res.status(400).json({ success: false, error: 'ID client invalide' });
      return;
    }

    const { from, to } = req.query;

    // Tiers info (replaces legacy clients lookup)
    const clientResult = await pool.query(
      'SELECT id, raison_sociale as nom, raison_sociale, prenom, email, telephone, adresse, nif FROM tiers WHERE id = $1 AND deleted_at IS NULL AND est_client = true',
      [clientId]
    );
    if (clientResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Client non trouvé' });
      return;
    }
    const client = clientResult.rows[0];

    // Totaux (all history, no date filter)
    const totauxQuery = `
      WITH
      f AS (SELECT COALESCE(SUM(total), 0) as total FROM factures WHERE tiers_id = $1 AND statut != 'annulee' AND deleted_at IS NULL),
      fa AS (SELECT COALESCE(SUM(total), 0) as total FROM factures_avoir WHERE tiers_id = $1 AND statut IN ('valide', 'utilise')),
      ac AS (SELECT COALESCE(SUM(montant), 0) as total FROM acomptes_clients WHERE tiers_id = $1 AND statut IN ('disponible', 'utilise')),
      p AS (SELECT COALESCE(SUM(p.montant), 0) as total FROM paiements p JOIN factures fa ON fa.id = p.facture_id WHERE fa.tiers_id = $1 AND fa.deleted_at IS NULL),
      alloc AS (SELECT COALESCE(SUM(montant_paye), 0) as total FROM factures WHERE tiers_id = $1 AND statut != 'annulee' AND deleted_at IS NULL)
      SELECT
        f.total as total_facture,
        p.total + ac.total as total_paye,
        alloc.total as total_alloue,
        (p.total + ac.total) - alloc.total as surplus,
        fa.total as total_avoir,
        ROUND(f.total - p.total - fa.total - ac.total) as solde,
        CASE
          WHEN f.total - p.total - fa.total - ac.total > 0 THEN 'debiteur'
          WHEN f.total - p.total - fa.total - ac.total < 0 THEN 'crediteur'
          ELSE 'solde'
        END as statut_solde
      FROM f, p, fa, ac, alloc
    `;
    const totauxResult = await pool.query(totauxQuery, [clientId]);
    const totaux = totauxResult.rows[0];

    // Mouvements with SQL running balance
    const mouvementsQuery = `
      WITH mouvements AS (
        SELECT
          date_facture::timestamp as date,
          'facture' as type,
          numero_facture as reference,
          'Facture ' || numero_facture as libelle,
          total as debit,
          0 as credit,
          id,
          1 as ordre,
          montant_paye,
          total - montant_paye as restant
        FROM factures
        WHERE tiers_id = $1 AND statut != 'annulee' AND deleted_at IS NULL

        UNION ALL

        SELECT
          p.date_paiement::timestamp,
          'paiement',
          COALESCE(p.reference, 'PAY-' || p.id),
          'Paiement ' || p.methode_paiement,
          0,
          p.montant,
          p.id,
          2,
          NULL as montant_paye,
          NULL as restant
        FROM paiements p
        JOIN factures f ON f.id = p.facture_id
        WHERE f.tiers_id = $1 AND f.deleted_at IS NULL

        UNION ALL

        SELECT
          date_avoir::timestamp,
          'avoir',
          numero_avoir,
          'Avoir ' || numero_avoir,
          0,
          total,
          id,
          3,
          NULL as montant_paye,
          NULL as restant
        FROM factures_avoir
        WHERE tiers_id = $1 AND statut IN ('valide', 'utilise')

        UNION ALL

        SELECT
          date_acompte::timestamp,
          'acompte',
          'ACO-' || id,
          'Acompte client',
          0,
          montant,
          id,
          4,
          NULL as montant_paye,
          NULL as restant
        FROM acomptes_clients
        WHERE tiers_id = $1 AND statut IN ('disponible', 'utilise')
      ),
      filtered AS (
        SELECT * FROM mouvements
        WHERE ($2::date IS NULL OR date::date >= $2::date)
          AND ($3::date IS NULL OR date::date <= $3::date)
      )
      SELECT
        date::text as date,
        type,
        reference,
        libelle,
        debit,
        credit,
        montant_paye,
        restant,
        SUM(debit - credit) OVER (ORDER BY date ASC, ordre ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as solde_apres
      FROM filtered
      ORDER BY date ASC, ordre ASC, id ASC
    `;
    const mouvementsResult = await pool.query(mouvementsQuery, [
      clientId,
      from || null,
      to || null,
    ]);

    res.json({
      success: true,
      data: {
        client,
        totaux: {
          total_facture: parseFloat(totaux.total_facture),
          total_paye: parseFloat(totaux.total_paye),
          total_alloue: parseFloat(totaux.total_alloue),
          surplus: parseFloat(totaux.surplus),
          total_avoir: parseFloat(totaux.total_avoir),
          solde: parseInt(totaux.solde),
          statut_solde: totaux.statut_solde,
        },
        mouvements: mouvementsResult.rows.map((row: any) => ({
          date: row.date,
          type: row.type,
          reference: row.reference,
          libelle: row.libelle,
          debit: parseFloat(row.debit),
          credit: parseFloat(row.credit),
          montant_paye: row.montant_paye ? parseFloat(row.montant_paye) : null,
          restant: row.restant ? parseFloat(row.restant) : null,
          solde_apres: parseInt(row.solde_apres),
        })),
      },
    });
  } catch (error: any) {
    console.error('GET /api/clients/:id/compte error:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// CRUD shims → TiersController
router.get('/:id', TiersController.getById);
router.get('/:id/historique', (req: Request, res: Response) => {
  // Delegate to tiers compte endpoint
  TiersController.getCompte(req, res);
});
router.post('/', (req: Request, res: Response) => {
  req.body.est_client = true;
  req.body.est_fournisseur = req.body.est_fournisseur ?? false;
  if (!req.body.raison_sociale && req.body.nom) {
    req.body.raison_sociale = req.body.nom;
  }
  TiersController.create(req, res);
});
router.put('/:id', TiersController.update);
router.delete('/:id', TiersController.delete);

export default router;

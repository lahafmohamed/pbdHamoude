import { Request, Response } from 'express';
import pool from '../db/connection';
import { caisseMagasinService } from '../services/CaisseMagasinService';
import { ClientAllocationService } from '../services/ClientAllocationService';
import { AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

export class AcompteController {
  /**
   * Manually apply an acompte (or part of it) to a specific facture.
   * No caisse movement (money already entered when acompte was created).
   * Triggers will sync acomptes_clients.montant_restant + statut.
   */
  static async apply(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const acompteId = parseInt(req.params.id);
      const { facture_id, montant, idempotency_key } = req.body;
      const userId = (req as AuthRequest).user?.id || null;

      if (!facture_id || !montant || Number(montant) <= 0) {
        res.status(400).json({ error: 'facture_id et montant > 0 obligatoires' });
        return;
      }

      await client.query('BEGIN');

      if (idempotency_key) {
        const { rows: dup } = await client.query(
          `SELECT app.* FROM acompte_applications app
           JOIN paiements p ON app.paiement_id = p.id
           WHERE p.idempotency_key = $1`,
          [idempotency_key]
        );
        if (dup.length > 0) {
          await client.query('COMMIT');
          res.status(200).json({ idempotent: true, application: dup[0] });
          return;
        }
      }

      const { rows: acRows } = await client.query(
        `SELECT id, tiers_id, montant, montant_restant, statut, methode_paiement
         FROM acomptes_clients
         WHERE id = $1 AND (deleted_at IS NULL)
         FOR UPDATE`,
        [acompteId]
      );
      if (acRows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Acompte introuvable' });
        return;
      }
      const acompte = acRows[0];
      if (acompte.statut === 'rembourse') {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Acompte déjà remboursé' });
        return;
      }
      const acRestant = parseFloat(acompte.montant_restant);
      const montantNum = Number(montant);
      if (montantNum > acRestant + 0.005) {
        await client.query('ROLLBACK');
        res.status(422).json({ error: `Montant dépasse le restant de l'acompte (${acRestant})` });
        return;
      }

      const { rows: facRows } = await client.query(
        `SELECT id, tiers_id, total, montant_paye,
                GREATEST(total - montant_paye, 0) AS remaining, location_id, statut
         FROM factures WHERE id = $1 FOR UPDATE`,
        [facture_id]
      );
      if (facRows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Facture introuvable' });
        return;
      }
      const facture = facRows[0];
      if (facture.tiers_id !== acompte.tiers_id) {
        await client.query('ROLLBACK');
        res.status(422).json({ error: 'Acompte et facture appartiennent à des tiers différents' });
        return;
      }
      if (facture.statut === 'annulee') {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Facture annulée' });
        return;
      }
      const remaining = parseFloat(facture.remaining);
      if (montantNum > remaining + 0.005) {
        await client.query('ROLLBACK');
        res.status(422).json({ error: `Montant dépasse le reste dû de la facture (${remaining})` });
        return;
      }

      const magasinId = facture.location_id
        ? (await client.query('SELECT id FROM magasins WHERE location_id = $1 LIMIT 1', [facture.location_id])).rows[0]?.id
        : null;

      const { rows: payRows } = await client.query(
        `INSERT INTO paiements (
          facture_id, montant, methode_paiement, date_paiement,
          reference, notes, magasin_id, source, idempotency_key, cree_par
        ) VALUES ($1,$2,$3,CURRENT_TIMESTAMP,$4,$5,$6,'acompte_application',$7,$8)
        RETURNING id`,
        [facture_id, montantNum, acompte.methode_paiement || 'espece',
          `ACO-APP-${acompteId}`, `Application acompte #${acompteId}`,
          magasinId, idempotency_key || null, userId]
      );

      await client.query(
        `INSERT INTO acompte_applications (acompte_id, facture_id, paiement_id, montant, cree_par)
         VALUES ($1,$2,$3,$4,$5)`,
        [acompteId, facture_id, payRows[0].id, montantNum, userId]
      );

      await client.query(
        `INSERT INTO compte_client_lignes
           (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
         VALUES ($1, 'paiement', $2, $3, 0, $4, $5, $6)`,
        [acompte.tiers_id, payRows[0].id, `PAI-${payRows[0].id}`, montantNum,
          `Application acompte #${acompteId} sur facture #${facture_id}`, userId]
      );

      await ClientAllocationService.recomputeClientAllocations(acompte.tiers_id, { transaction: client });

      await client.query('COMMIT');
      res.status(201).json({
        acompte_id: acompteId,
        facture_id,
        paiement_id: payRows[0].id,
        montant_applique: montantNum,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error({ err: err?.message }, 'Erreur POST /api/acomptes/:id/apply');
      res.status(500).json({ error: err?.message || 'Erreur serveur' });
    } finally {
      client.release();
    }
  }

  /**
   * Refund unused portion of an acompte (cash out).
   * Requires open session of the acompte's magasin.
   */
  static async refund(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const acompteId = parseInt(req.params.id);
      const { montant, methode_paiement, session_caisse_id, notes, idempotency_key } = req.body;
      const userId = (req as AuthRequest).user?.id || null;

      const VALID_METHODS = ['espece','carte','cheque','virement','mobile_money','orange_money','mtn_money','wave'];
      if (!montant || Number(montant) <= 0) {
        res.status(400).json({ error: 'montant > 0 obligatoire' });
        return;
      }
      if (!methode_paiement || !VALID_METHODS.includes(methode_paiement)) {
        res.status(400).json({ error: 'methode_paiement invalide' });
        return;
      }

      await client.query('BEGIN');

      const { rows: acRows } = await client.query(
        `SELECT * FROM acomptes_clients WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [acompteId]
      );
      if (acRows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Acompte introuvable' });
        return;
      }
      const acompte = acRows[0];
      const acRestant = parseFloat(acompte.montant_restant);
      const montantNum = Number(montant);
      if (montantNum > acRestant + 0.005) {
        await client.query('ROLLBACK');
        res.status(422).json({ error: `Montant dépasse le restant (${acRestant})` });
        return;
      }
      if (acompte.statut === 'rembourse') {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Acompte déjà remboursé' });
        return;
      }

      // Resolve session
      let effectiveSessionId: number | null = session_caisse_id || null;
      if (!effectiveSessionId) {
        const targetMagasinId = acompte.magasin_id;
        if (!targetMagasinId) {
          await client.query('ROLLBACK');
          res.status(422).json({ error: 'magasin_id ou session_caisse_id requis' });
          return;
        }
        const { rows: sessRows } = await client.query(
          `SELECT id FROM sessions_caisse WHERE magasin_id = $1 AND statut = 'ouverte' LIMIT 1`,
          [targetMagasinId]
        );
        if (sessRows.length === 0) {
          await client.query('ROLLBACK');
          res.status(409).json({ error: 'Aucune session caisse ouverte pour ce magasin' });
          return;
        }
        effectiveSessionId = sessRows[0].id;
      }

      const mouvement = await caisseMagasinService.enregistrerMouvement(client, {
        session_caisse_id: effectiveSessionId!,
        type: 'decaissement',
        categorie: 'remboursement_client',
        montant: montantNum,
        methode_paiement,
        reference_type: 'acompte',
        reference_id: acompteId,
        libelle: `Remboursement acompte #${acompteId}`,
        user_id: userId || undefined,
        idempotency_key: idempotency_key || undefined,
      });

      // Decrement montant_restant; statut→rembourse only if fully refunded
      const newRestant = acRestant - montantNum;
      const newStatut = newRestant <= 0.005 ? 'rembourse' : acompte.statut;
      await client.query(
        `UPDATE acomptes_clients
         SET montant_restant = $1,
             statut = $2,
             rembourse_par_user_id = COALESCE(rembourse_par_user_id, $3),
             date_remboursement = COALESCE(date_remboursement, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [Math.max(0, newRestant), newStatut, userId, acompteId]
      );

      // Ledger: debit (we owe customer less now — restore balance)
      await client.query(
        `INSERT INTO compte_client_lignes
           (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
         VALUES ($1, 'ajustement', $2, $3, $4, 0, $5, $6)`,
        [acompte.tiers_id, acompteId, `REMB-ACO-${acompteId}`, montantNum,
          `Remboursement acompte #${acompteId}`, userId]
      );

      await ClientAllocationService.recomputeClientAllocations(acompte.tiers_id, { transaction: client });

      await client.query('COMMIT');
      res.status(201).json({
        acompte_id: acompteId,
        montant_rembourse: montantNum,
        nouveau_restant: Math.max(0, newRestant),
        statut: newStatut,
        mouvement_caisse_id: mouvement.id,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error({ err: err?.message }, 'Erreur POST /api/acomptes/:id/refund');
      res.status(500).json({ error: err?.message || 'Erreur serveur' });
    } finally {
      client.release();
    }
  }

  /**
   * List applications of an acompte.
   */
  static async listApplications(req: Request, res: Response): Promise<void> {
    try {
      const acompteId = parseInt(req.params.id);
      const { rows } = await pool.query(
        `SELECT app.*, f.numero_facture
         FROM acompte_applications app
         JOIN factures f ON f.id = app.facture_id
         WHERE app.acompte_id = $1
         ORDER BY app.date_application ASC`,
        [acompteId]
      );
      res.json({ data: rows });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erreur serveur' });
    }
  }

  /**
   * Apply supplier acompte (or part of it) to a facture_fournisseur.
   * Mirrors apply() but supplier-side: no caisse mvt (money already out).
   */
  static async applyFournisseur(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const acompteId = parseInt(req.params.id);
      const { facture_id, montant, idempotency_key } = req.body;
      const userId = (req as AuthRequest).user?.id || null;

      if (!facture_id || !montant || Number(montant) <= 0) {
        res.status(400).json({ error: 'facture_id et montant > 0 obligatoires' });
        return;
      }

      await client.query('BEGIN');

      if (idempotency_key) {
        const { rows: dup } = await client.query(
          `SELECT app.* FROM acompte_applications_fournisseur app
           JOIN paiements_fournisseur p ON app.paiement_id = p.id
           WHERE p.idempotency_key = $1`,
          [idempotency_key]
        );
        if (dup.length > 0) {
          await client.query('COMMIT');
          res.status(200).json({ idempotent: true, application: dup[0] });
          return;
        }
      }

      const { rows: acRows } = await client.query(
        `SELECT id, tiers_id, montant, montant_restant, statut, methode_paiement, magasin_id
         FROM acomptes_fournisseur
         WHERE id = $1 AND (deleted_at IS NULL)
         FOR UPDATE`,
        [acompteId]
      );
      if (acRows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Acompte fournisseur introuvable' });
        return;
      }
      const acompte = acRows[0];
      if (acompte.statut === 'rembourse') {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Acompte déjà remboursé' });
        return;
      }
      const acRestant = parseFloat(acompte.montant_restant);
      const montantNum = Number(montant);
      if (montantNum > acRestant + 0.005) {
        await client.query('ROLLBACK');
        res.status(422).json({ error: `Montant dépasse le restant de l'acompte (${acRestant})` });
        return;
      }

      const { rows: facRows } = await client.query(
        `SELECT id, tiers_id, total, montant_paye,
                GREATEST(total - COALESCE(montant_paye,0), 0) AS remaining, statut
         FROM factures_fournisseur WHERE id = $1 FOR UPDATE`,
        [facture_id]
      );
      if (facRows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Facture fournisseur introuvable' });
        return;
      }
      const facture = facRows[0];
      if (facture.tiers_id !== acompte.tiers_id) {
        await client.query('ROLLBACK');
        res.status(422).json({ error: 'Acompte et facture appartiennent à des fournisseurs différents' });
        return;
      }
      if (facture.statut === 'annulee') {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Facture annulée' });
        return;
      }
      const remaining = parseFloat(facture.remaining);
      if (montantNum > remaining + 0.005) {
        await client.query('ROLLBACK');
        res.status(422).json({ error: `Montant dépasse le reste dû de la facture (${remaining})` });
        return;
      }

      const { rows: payRows } = await client.query(
        `INSERT INTO paiements_fournisseur (
          facture_id, montant, methode_paiement, date_paiement,
          reference, notes, magasin_id, source, idempotency_key, effectue_par
        ) VALUES ($1,$2,$3,CURRENT_TIMESTAMP,$4,$5,$6,'acompte_application',$7,$8)
        RETURNING id`,
        [facture_id, montantNum, acompte.methode_paiement || 'espece',
          `ACOF-APP-${acompteId}`, `Application acompte fournisseur #${acompteId}`,
          acompte.magasin_id, idempotency_key || null, userId]
      );

      await client.query(
        `INSERT INTO acompte_applications_fournisseur (acompte_id, facture_id, paiement_id, montant, cree_par)
         VALUES ($1,$2,$3,$4,$5)`,
        [acompteId, facture_id, payRows[0].id, montantNum, userId]
      );

      // Ledger: credit fournisseur ledger (we paid via acompte → reduces AP)
      await client.query(
        `INSERT INTO compte_fournisseur_lignes
           (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
         VALUES ($1, 'paiement', $2, $3, $4, 0, $5, $6)`,
        [acompte.tiers_id, payRows[0].id, `PAIF-${payRows[0].id}`, montantNum,
          `Application acompte fournisseur #${acompteId} sur facture #${facture_id}`, userId]
      );

      await client.query('COMMIT');
      res.status(201).json({
        acompte_id: acompteId,
        facture_id,
        paiement_id: payRows[0].id,
        montant_applique: montantNum,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error({ err: err?.message }, 'Erreur POST /api/acomptes-fournisseur/:id/apply');
      res.status(500).json({ error: err?.message || 'Erreur serveur' });
    } finally {
      client.release();
    }
  }

  /**
   * Refund unused supplier acompte (cash IN — supplier gives money back).
   */
  static async refundFournisseur(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const acompteId = parseInt(req.params.id);
      const { montant, methode_paiement, session_caisse_id, notes, idempotency_key } = req.body;
      const userId = (req as AuthRequest).user?.id || null;

      const VALID_METHODS = ['espece','carte','cheque','virement','mobile_money','orange_money','mtn_money','wave'];
      if (!montant || Number(montant) <= 0) {
        res.status(400).json({ error: 'montant > 0 obligatoire' });
        return;
      }
      if (!methode_paiement || !VALID_METHODS.includes(methode_paiement)) {
        res.status(400).json({ error: 'methode_paiement invalide' });
        return;
      }

      await client.query('BEGIN');

      const { rows: acRows } = await client.query(
        `SELECT * FROM acomptes_fournisseur WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [acompteId]
      );
      if (acRows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Acompte fournisseur introuvable' });
        return;
      }
      const acompte = acRows[0];
      const acRestant = parseFloat(acompte.montant_restant);
      const montantNum = Number(montant);
      if (montantNum > acRestant + 0.005) {
        await client.query('ROLLBACK');
        res.status(422).json({ error: `Montant dépasse le restant (${acRestant})` });
        return;
      }
      if (acompte.statut === 'rembourse') {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Acompte déjà remboursé' });
        return;
      }

      // Resolve session — supplier refund = supplier returns cash → encaissement
      let effectiveSessionId: number | null = session_caisse_id || null;
      if (!effectiveSessionId) {
        const targetMagasinId = acompte.magasin_id;
        if (!targetMagasinId) {
          await client.query('ROLLBACK');
          res.status(422).json({ error: 'magasin_id ou session_caisse_id requis' });
          return;
        }
        const { rows: sessRows } = await client.query(
          `SELECT id FROM sessions_caisse WHERE magasin_id = $1 AND statut = 'ouverte' LIMIT 1`,
          [targetMagasinId]
        );
        if (sessRows.length === 0) {
          await client.query('ROLLBACK');
          res.status(409).json({ error: 'Aucune session caisse ouverte pour ce magasin' });
          return;
        }
        effectiveSessionId = sessRows[0].id;
      }

      const mouvement = await caisseMagasinService.enregistrerMouvement(client, {
        session_caisse_id: effectiveSessionId!,
        type: 'encaissement',
        categorie: 'autre_entree',
        montant: montantNum,
        methode_paiement,
        reference_type: 'acompte_fournisseur',
        reference_id: acompteId,
        libelle: `Remboursement acompte fournisseur #${acompteId}`,
        user_id: userId || undefined,
        idempotency_key: idempotency_key || undefined,
      });

      const newRestant = acRestant - montantNum;
      const newStatut = newRestant <= 0.005 ? 'rembourse' : acompte.statut;
      await client.query(
        `UPDATE acomptes_fournisseur
         SET montant_restant = $1,
             statut = $2,
             rembourse_par_user_id = COALESCE(rembourse_par_user_id, $3),
             date_remboursement = COALESCE(date_remboursement, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [Math.max(0, newRestant), newStatut, userId, acompteId]
      );

      // Ledger: credit (supplier returned funds → AP increases)
      await client.query(
        `INSERT INTO compte_fournisseur_lignes
           (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
         VALUES ($1, 'ajustement', $2, $3, 0, $4, $5, $6)`,
        [acompte.tiers_id, acompteId, `REMB-ACOF-${acompteId}`, montantNum,
          `Remboursement acompte fournisseur #${acompteId}`, userId]
      );

      await client.query('COMMIT');
      res.status(201).json({
        acompte_id: acompteId,
        montant_rembourse: montantNum,
        nouveau_restant: Math.max(0, newRestant),
        statut: newStatut,
        mouvement_caisse_id: mouvement.id,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      logger.error({ err: err?.message }, 'Erreur POST /api/acomptes-fournisseur/:id/refund');
      res.status(500).json({ error: err?.message || 'Erreur serveur' });
    } finally {
      client.release();
    }
  }

  /**
   * List applications of a supplier acompte.
   */
  static async listApplicationsFournisseur(req: Request, res: Response): Promise<void> {
    try {
      const acompteId = parseInt(req.params.id);
      const { rows } = await pool.query(
        `SELECT app.*, f.numero_facture
         FROM acompte_applications_fournisseur app
         JOIN factures_fournisseur f ON f.id = app.facture_id
         WHERE app.acompte_id = $1
         ORDER BY app.date_application ASC`,
        [acompteId]
      );
      res.json({ data: rows });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erreur serveur' });
    }
  }

  /**
   * Get supplier acompte by id with applications + remaining.
   */
  static async getByIdFournisseur(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const { rows } = await pool.query(
        `SELECT ac.*, t.raison_sociale AS tiers_nom
         FROM acomptes_fournisseur ac
         JOIN tiers t ON t.id = ac.tiers_id
         WHERE ac.id = $1`,
        [id]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Acompte fournisseur introuvable' });
        return;
      }
      const { rows: apps } = await pool.query(
        `SELECT app.*, f.numero_facture
         FROM acompte_applications_fournisseur app
         JOIN factures_fournisseur f ON f.id = app.facture_id
         WHERE app.acompte_id = $1
         ORDER BY app.date_application ASC`,
        [id]
      );
      res.json({ data: { ...rows[0], applications: apps } });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erreur serveur' });
    }
  }

  /**
   * Get acompte by id with applications + remaining.
   */
  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const { rows } = await pool.query(
        `SELECT ac.*, t.raison_sociale AS tiers_nom
         FROM acomptes_clients ac
         JOIN tiers t ON t.id = ac.tiers_id
         WHERE ac.id = $1`,
        [id]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Acompte introuvable' });
        return;
      }
      const { rows: apps } = await pool.query(
        `SELECT app.*, f.numero_facture
         FROM acompte_applications app
         JOIN factures f ON f.id = app.facture_id
         WHERE app.acompte_id = $1
         ORDER BY app.date_application ASC`,
        [id]
      );
      res.json({ data: { ...rows[0], applications: apps } });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erreur serveur' });
    }
  }
}

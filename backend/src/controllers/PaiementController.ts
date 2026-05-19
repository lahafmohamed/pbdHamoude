import { Request, Response } from 'express';
import pool from '../db/connection';
import { Paiement, PaiementWithFacture } from '../models/Paiement';
import { parsePagination } from '../utils/pagination';
import { logger } from '../utils/logger';
import { ClientAllocationService } from '../services/ClientAllocationService';
import { caisseMagasinService } from '../services/CaisseMagasinService';
import { AuthRequest } from '../middleware/auth';

export class PaiementController {

  /**
   * Record a new payment on a facture.
   *
   * Flow:
   *  1. Idempotency check (idempotency_key short-circuit).
   *  2. Auto-apply available acomptes FIFO to outstanding balance.
   *     Each application creates a paiements row (source='acompte_application')
   *     and an acompte_applications ledger row. NO caisse movement (no cash today).
   *  3. Remainder (montant - applied) recorded as direct paiement (source='direct')
   *     and a single mouvement_caisse line.
   *  4. Caisse error = rollback. No swallow.
   */
  static async create(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();

    try {
      const { factureId } = req.params;
      const {
        montant,
        methode_paiement,
        date_paiement,
        reference,
        notes,
        session_caisse_id,
        idempotency_key,
        skip_acompte_application,
      }: {
        montant: number;
        methode_paiement: 'espece' | 'carte' | 'cheque' | 'virement' | 'mobile_money' | 'orange_money' | 'mtn_money' | 'wave';
        date_paiement?: string;
        reference?: string;
        notes?: string;
        session_caisse_id?: number;
        idempotency_key?: string;
        skip_acompte_application?: boolean;
      } = req.body;

      const VALID_METHODS = ['espece', 'carte', 'cheque', 'virement', 'mobile_money', 'orange_money', 'mtn_money', 'wave'];

      if (!montant || Number(montant) <= 0) {
        res.status(400).json({ error: 'Le montant doit être supérieur à 0' });
        return;
      }
      if (!methode_paiement || !VALID_METHODS.includes(methode_paiement)) {
        res.status(400).json({ error: 'Méthode de paiement invalide' });
        return;
      }

      const authReq = req as AuthRequest;
      const userId = authReq.user?.id || null;
      const datePaiement = date_paiement || new Date().toISOString();

      await client.query('BEGIN');

      // Idempotency
      if (idempotency_key) {
        const { rows: dup } = await client.query(
          'SELECT * FROM paiements WHERE idempotency_key = $1',
          [idempotency_key]
        );
        if (dup.length > 0) {
          await client.query('COMMIT');
          res.status(200).json({ idempotent: true, ...dup[0] });
          return;
        }
      }

      // Lock facture row to serialize concurrent payments
      const { rows: factureRows } = await client.query(
        `SELECT id, tiers_id, statut, location_id, total, montant_paye,
                GREATEST(total - montant_paye, 0) AS remaining
         FROM factures WHERE id = $1 FOR UPDATE`,
        [factureId]
      );

      if (factureRows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Facture non trouvée' });
        return;
      }

      const facture = factureRows[0];
      if (facture.statut === 'annulee') {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Impossible d\'ajouter un paiement sur une facture annulée' });
        return;
      }

      const clientId = facture.tiers_id;
      const locationId = facture.location_id;
      const remainingDue = parseFloat(facture.remaining);
      const montantNum = Number(montant);

      if (montantNum > remainingDue + 0.005) {
        await client.query('ROLLBACK');
        res.status(422).json({ error: `Montant (${montantNum}) dépasse le reste dû (${remainingDue})` });
        return;
      }

      // Resolve magasin / session for caisse
      let effectiveMagasinId: number | null = null;
      if (locationId) {
        const { rows: magRows } = await client.query(
          'SELECT id FROM magasins WHERE location_id = $1 LIMIT 1',
          [locationId]
        );
        if (magRows.length > 0) effectiveMagasinId = magRows[0].id;
      }

      let effectiveSessionCaisseId: number | null = session_caisse_id || null;
      if (!effectiveSessionCaisseId && effectiveMagasinId) {
        const { rows: sessRows } = await client.query(
          'SELECT id FROM sessions_caisse WHERE magasin_id = $1 AND statut = $2 LIMIT 1',
          [effectiveMagasinId, 'ouverte']
        );
        if (sessRows.length > 0) effectiveSessionCaisseId = sessRows[0].id;
      }

      if (methode_paiement === 'espece' && !effectiveSessionCaisseId) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Aucune session caisse ouverte — impossible de recevoir des espèces' });
        return;
      }

      // ── Step 1: auto-apply available acomptes FIFO ──
      let appliedFromAcomptes = 0;
      const applications: any[] = [];

      if (!skip_acompte_application) {
        const { rows: acomptes } = await client.query(
          `SELECT id, montant_restant
           FROM acomptes_clients
           WHERE tiers_id = $1
             AND statut IN ('disponible','partiellement_utilise')
             AND COALESCE(deleted_at, NULL) IS NULL
             AND montant_restant > 0
           ORDER BY date_acompte ASC, id ASC
           FOR UPDATE`,
          [clientId]
        );

        let remainingNeeded = remainingDue; // apply up to invoice balance, not just payload montant
        for (const ac of acomptes) {
          if (remainingNeeded <= 0) break;
          const acRestant = parseFloat(ac.montant_restant);
          const toApply = Math.min(acRestant, remainingNeeded);
          if (toApply <= 0) continue;

          // Create paiement row for this application
          const { rows: payRows } = await client.query(
            `INSERT INTO paiements (
              facture_id, montant, methode_paiement, date_paiement,
              reference, notes, session_caisse_id, magasin_id, source, cree_par
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'acompte_application',$9)
            RETURNING id`,
            [factureId, toApply, methode_paiement, datePaiement,
              `ACO-APP-${ac.id}`, `Application acompte #${ac.id}`,
              null, effectiveMagasinId, userId]
          );

          await client.query(
            `INSERT INTO acompte_applications (acompte_id, facture_id, paiement_id, montant, cree_par)
             VALUES ($1,$2,$3,$4,$5)`,
            [ac.id, factureId, payRows[0].id, toApply, userId]
          );

          // Ledger: credit (client paid via acompte balance)
          await client.query(
            `INSERT INTO compte_client_lignes
               (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
             VALUES ($1, 'paiement', $2, $3, 0, $4, $5, $6)`,
            [clientId, payRows[0].id, `PAI-${payRows[0].id}`, toApply,
              `Application acompte #${ac.id} sur facture #${factureId}`, userId]
          );

          applications.push({ acompte_id: ac.id, paiement_id: payRows[0].id, montant: toApply });
          appliedFromAcomptes += toApply;
          remainingNeeded -= toApply;
        }
      }

      // ── Step 2: direct payment for remainder ──
      const directMontant = Math.max(0, montantNum - appliedFromAcomptes);
      let directPaiementId: number | null = null;

      if (directMontant > 0) {
        const { rows: payRows } = await client.query(
          `INSERT INTO paiements (
            facture_id, montant, methode_paiement, date_paiement,
            reference, notes, session_caisse_id, magasin_id, source,
            idempotency_key, cree_par
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'direct',$9,$10)
          RETURNING id, date_paiement`,
          [factureId, directMontant, methode_paiement, datePaiement,
            reference || null, notes || null,
            effectiveSessionCaisseId, effectiveMagasinId,
            idempotency_key || null, userId]
        );
        directPaiementId = payRows[0].id;

        // Caisse movement (any tracked method when session known). FAIL tx if fails.
        if (effectiveSessionCaisseId) {
          const mouvement = await caisseMagasinService.enregistrerMouvement(client, {
            session_caisse_id: effectiveSessionCaisseId,
            type: 'encaissement',
            categorie: 'paiement_client',
            montant: directMontant,
            methode_paiement,
            reference_type: 'paiement',
            reference_id: directPaiementId!,
            libelle: `Paiement facture #${factureId}`,
            user_id: userId || undefined,
            idempotency_key: idempotency_key ? `${idempotency_key}:mvt` : undefined,
          });

          await client.query(
            'UPDATE paiements SET mouvement_caisse_id = $1 WHERE id = $2',
            [mouvement.id, directPaiementId]
          );
        }

        // Ledger
        await client.query(
          `INSERT INTO compte_client_lignes
             (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
           VALUES ($1, 'paiement', $2, $3, 0, $4, $5, $6)`,
          [clientId, directPaiementId, `PAI-${directPaiementId}`, directMontant, notes || null, userId]
        );
      }

      await ClientAllocationService.recomputeClientAllocations(clientId, { transaction: client });

      await client.query('COMMIT');

      res.status(201).json({
        facture_id: parseInt(factureId),
        montant_recu: montantNum,
        applique_depuis_acomptes: appliedFromAcomptes,
        applications,
        direct_paiement_id: directPaiementId,
        direct_montant: directMontant,
        methode_paiement,
        session_caisse_id: effectiveSessionCaisseId,
        message: appliedFromAcomptes > 0
          ? `Acomptes appliqués (${appliedFromAcomptes}), reste encaissé: ${directMontant}`
          : 'Paiement enregistré',
      });

    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error({ err: error?.message || error }, 'Erreur POST /api/factures/:factureId/paiements');
      res.status(500).json({ error: error?.message || 'Erreur serveur' });
    } finally {
      client.release();
    }
  }

  /**
   * Get all payments for a specific invoice
   */
  static async getByFacture(req: Request, res: Response): Promise<void> {
    try {
      const { factureId } = req.params;

      // Verify invoice exists
      const { rows: factureRows } = await pool.query(
        'SELECT id FROM factures WHERE id = $1',
        [factureId]
      );

      if (factureRows.length === 0) {
        res.status(404).json({ error: 'Facture non trouvée' });
        return;
      }

      const { rows } = await pool.query(
        `SELECT * FROM paiements WHERE facture_id = $1 ORDER BY date_paiement DESC`,
        [factureId]
      );

      res.json(rows);
    } catch (error) {
      logger.error({ err: error }, 'Erreur GET /api/factures/:factureId/paiements');
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Get all payments across all invoices (with pagination)
   */
  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { methode, date_debut, date_fin } = req.query;

      let query = `
        SELECT p.*, f.numero_facture, t.raison_sociale as client_nom, t.prenom as client_prenom
        FROM paiements p
        LEFT JOIN factures f ON p.facture_id = f.id
        LEFT JOIN tiers t ON f.tiers_id = t.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (methode) {
        query += ' AND p.methode_paiement = $' + (params.length + 1);
        params.push(methode);
      }

      if (date_debut) {
        query += ' AND p.date_paiement >= $' + (params.length + 1);
        params.push(date_debut);
      }

      if (date_fin) {
        query += ' AND p.date_paiement <= $' + (params.length + 1);
        params.push(date_fin);
      }

      query += ' ORDER BY p.date_paiement DESC';

      // Pagination (clamped)
      const { page: pageNum, limit: limitNum } = parsePagination(req.query);
      const offset = (pageNum - 1) * limitNum;
      query += ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limitNum, offset);

      const { rows } = await pool.query(query, params);

      // Get total count
      let countQuery = `
        SELECT COUNT(*) FROM paiements p
        LEFT JOIN factures f ON p.facture_id = f.id
        WHERE 1=1
      `;
      const countParams: any[] = [];
      if (methode) {
        countQuery += ' AND p.methode_paiement = $' + (countParams.length + 1);
        countParams.push(methode);
      }
      if (date_debut) {
        countQuery += ' AND p.date_paiement >= $' + (countParams.length + 1);
        countParams.push(date_debut);
      }
      if (date_fin) {
        countQuery += ' AND p.date_paiement <= $' + (countParams.length + 1);
        countParams.push(date_fin);
      }

      const { rows: countRows } = await pool.query(countQuery, countParams);
      const total = parseInt(countRows[0].count);

      res.json({
        data: rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        }
      });
    } catch (error) {
      console.error('Erreur GET /api/paiements:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Get payment statistics
   */
  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      // Total payments by method
      const { rows: parMethode } = await pool.query(
        `SELECT methode_paiement, COUNT(*) as nombre, SUM(montant) as total
         FROM paiements
         GROUP BY methode_paiement
         ORDER BY total DESC`
      );

      // Payments this month
      const { rows: moisActuel } = await pool.query(
        `SELECT COUNT(*) as nombre, COALESCE(SUM(montant), 0) as total
         FROM paiements
         WHERE EXTRACT(MONTH FROM date_paiement) = EXTRACT(MONTH FROM CURRENT_DATE)
           AND EXTRACT(YEAR FROM date_paiement) = EXTRACT(YEAR FROM CURRENT_DATE)`
      );

      // Payments today
      const { rows: aujourdhui } = await pool.query(
        `SELECT COUNT(*) as nombre, COALESCE(SUM(montant), 0) as total
         FROM paiements
         WHERE DATE(date_paiement) = CURRENT_DATE`
      );

      // Average payment amount
      const { rows: moyenne } = await pool.query(
        `SELECT AVG(montant) as moyenne_paiement
         FROM paiements`
      );

      res.json({
        par_methode: parMethode,
        mois_actuel: moisActuel[0],
        aujourdhui: aujourdhui[0],
        moyenne: moyenne[0]
      });
    } catch (error) {
      console.error('Erreur GET /api/paiements/stats:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Update a payment (triggers FIFO reallocation)
   */
  static async update(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { montant, methode_paiement, reference, notes, date_paiement }: {
        montant?: number;
        methode_paiement?: 'espece' | 'carte' | 'cheque' | 'virement' | 'mobile_money' | 'orange_money' | 'mtn_money' | 'wave';
        reference?: string;
        notes?: string;
        date_paiement?: string;
      } = req.body;

      // Check if payment exists and get client info
      const { rows: existingPayment } = await client.query(
        `SELECT p.*, f.tiers_id
         FROM paiements p
         JOIN factures f ON f.id = p.facture_id
         WHERE p.id = $1`,
        [id]
      );

      if (existingPayment.length === 0) {
        res.status(404).json({ error: 'Paiement non trouvé' });
        return;
      }

      const payment = existingPayment[0];

      // Validate amount if provided
      if (montant && montant <= 0) {
        res.status(400).json({ error: 'Le montant doit être supérieur à 0' });
        return;
      }

      // Update payment
      await client.query(
        `UPDATE paiements SET
          montant = COALESCE($1, montant),
          methode_paiement = COALESCE($2, methode_paiement),
          reference = COALESCE($3, reference),
          notes = COALESCE($4, notes),
          date_paiement = COALESCE($5, date_paiement)
         WHERE id = $6`,
        [montant, methode_paiement, reference, notes, date_paiement, id]
      );

      await ClientAllocationService.recomputeClientAllocations(payment.tiers_id, { transaction: client });

      await client.query('COMMIT');

      res.json({ message: 'Paiement mis à jour et allocation FIFO recalculée' });

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Erreur PUT /api/paiements/:id');
      res.status(500).json({ error: 'Erreur serveur' });
    } finally {
      client.release();
    }
  }

  /**
   * Delete a payment (triggers FIFO reallocation)
   */
  static async delete(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { id } = req.params;

      const { rows: existingPayment } = await client.query(
        `SELECT p.*, f.tiers_id
         FROM paiements p
         JOIN factures f ON f.id = p.facture_id
         WHERE p.id = $1`,
        [id]
      );

      if (existingPayment.length === 0) {
        res.status(404).json({ error: 'Paiement non trouvé' });
        return;
      }

      const payment = existingPayment[0];

      // Customer ledger: reversal debit entry for payment deletion
      const authReqDel = req as AuthRequest;
      await client.query(
        `INSERT INTO compte_client_lignes
           (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
         VALUES ($1, 'ajustement', $2, $3, $4, 0, $5, $6)`,
        [
          payment.tiers_id,
          payment.id,
          `ANNUL-PAI-${payment.id}`,
          payment.montant,
          `Annulation paiement PAI-${payment.id}`,
          authReqDel.user?.id || null,
        ]
      );

      // Delete payment
      const { rowCount } = await client.query(
        'DELETE FROM paiements WHERE id = $1',
        [id]
      );

      await ClientAllocationService.recomputeClientAllocations(payment.tiers_id, { transaction: client });

      await client.query('COMMIT');

      res.json({ message: 'Paiement supprimé et allocation FIFO recalculée' });

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Erreur DELETE /api/paiements/:id');
      res.status(500).json({ error: 'Erreur serveur' });
    } finally {
      client.release();
    }
  }
}

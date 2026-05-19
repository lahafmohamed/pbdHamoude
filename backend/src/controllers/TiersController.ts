import { Request, Response } from 'express';
import { tiersService } from '../services/TiersService';
import { TiersAllocationService } from '../services/TiersAllocationService';
import { CompensationService } from '../services/CompensationService';
import { caisseMagasinService } from '../services/CaisseMagasinService';
import pool from '../db/connection';

export class TiersController {

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, role, page, limit, sort, order, statut_solde } = req.query;
      const result = await tiersService.getAll({
        search: search as string,
        role: role as any,
        page: parseInt(page as string) || 1,
        limit: parseInt(limit as string) || 20,
        sort: sort as string,
        order: (order as string)?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
        statut_solde: statut_solde as any,
      });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const tiers = await tiersService.getById(id);
      if (!tiers) { res.status(404).json({ success: false, error: 'Tiers introuvable' }); return; }
      res.json({ success: true, data: tiers });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async create(req: Request, res: Response): Promise<void> {
    try {
      const tiers = await tiersService.create(req.body);
      res.status(201).json({ success: true, data: tiers });
    } catch (err: any) {
      if (err.message?.includes('au moins un rôle')) {
        res.status(422).json({ success: false, error: err.message });
      } else {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  }

  static async update(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const tiers = await tiersService.update(id, req.body);
      if (!tiers) { res.status(404).json({ success: false, error: 'Tiers introuvable' }); return; }
      res.json({ success: true, data: tiers });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const ok = await tiersService.softDelete(id);
      if (!ok) { res.status(404).json({ success: false, error: 'Tiers introuvable' }); return; }
      res.json({ success: true, message: 'Tiers supprimé' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async search(req: Request, res: Response): Promise<void> {
    try {
      const { q, role } = req.query;
      if (!q) { res.json({ success: true, data: [] }); return; }
      const results = await tiersService.search(q as string, role as any);
      res.json({ success: true, data: results });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async getCompte(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const { from, to } = req.query;
      const compte = await tiersService.getCompte(id, { from: from as string, to: to as string });
      if (!compte) { res.status(404).json({ success: false, error: 'Tiers introuvable' }); return; }
      res.json({ success: true, data: compte });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async promouvoir(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const { role } = req.body;
      let tiers;
      if (role === 'client') tiers = await tiersService.promouvoirEnClient(id);
      else if (role === 'fournisseur') tiers = await tiersService.promouvoirEnFournisseur(id);
      else { res.status(422).json({ success: false, error: 'Rôle invalide: client ou fournisseur' }); return; }
      if (!tiers) { res.status(404).json({ success: false, error: 'Tiers introuvable' }); return; }
      res.json({ success: true, data: tiers });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async recordAcompteClient(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const tiersId = parseInt(req.params.id);
      const {
        montant,
        methode_paiement,
        notes,
        magasin_id,
        reference_number,
        session_caisse_id,
        idempotency_key,
      } = req.body;
      const userId = (req as any).user?.id || null;

      const VALID_METHODS = ['espece','carte','cheque','virement','mobile_money','orange_money','mtn_money','wave'];
      const CASH_METHODS = ['espece'];

      if (!montant || Number(montant) <= 0) {
        res.status(400).json({ success: false, error: 'Montant doit être > 0' });
        return;
      }
      if (!methode_paiement || !VALID_METHODS.includes(methode_paiement)) {
        res.status(400).json({ success: false, error: 'methode_paiement invalide' });
        return;
      }

      await client.query('BEGIN');

      // Idempotency short-circuit
      if (idempotency_key) {
        const { rows: dup } = await client.query(
          'SELECT * FROM acomptes_clients WHERE idempotency_key = $1',
          [idempotency_key]
        );
        if (dup.length > 0) {
          await client.query('COMMIT');
          res.status(200).json({ success: true, data: dup[0], idempotent: true });
          return;
        }
      }

      // Validate tiers exists and is client-role
      const { rows: tiersRows } = await client.query(
        'SELECT id, est_client FROM tiers WHERE id = $1 AND deleted_at IS NULL',
        [tiersId]
      );
      if (tiersRows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ success: false, error: 'Tiers introuvable' });
        return;
      }
      if (tiersRows[0].est_client === false) {
        await client.query('ROLLBACK');
        res.status(422).json({ success: false, error: 'Tiers n\'est pas un client — promouvoir d\'abord' });
        return;
      }

      // Resolve target session for any caisse-touching method
      let effectiveSessionId: number | null = session_caisse_id || null;
      let effectiveMagasinId: number | null = magasin_id || null;

      if (CASH_METHODS.includes(methode_paiement)) {
        if (!effectiveSessionId) {
          if (!effectiveMagasinId) {
            await client.query('ROLLBACK');
            res.status(422).json({ success: false, error: 'magasin_id ou session_caisse_id requis pour paiement espèces' });
            return;
          }
          const { rows: sessRows } = await client.query(
            'SELECT id FROM sessions_caisse WHERE magasin_id = $1 AND statut = $2 LIMIT 1',
            [effectiveMagasinId, 'ouverte']
          );
          if (sessRows.length === 0) {
            await client.query('ROLLBACK');
            res.status(409).json({ success: false, error: 'Aucune session caisse ouverte pour ce magasin' });
            return;
          }
          effectiveSessionId = sessRows[0].id;
        } else {
          const { rows: sessRows } = await client.query(
            'SELECT magasin_id FROM sessions_caisse WHERE id = $1 AND statut = $2',
            [effectiveSessionId, 'ouverte']
          );
          if (sessRows.length === 0) {
            await client.query('ROLLBACK');
            res.status(409).json({ success: false, error: 'Session caisse non ouverte' });
            return;
          }
          effectiveMagasinId = effectiveMagasinId || sessRows[0].magasin_id;
        }
      }

      // Insert acompte (montant_restant = montant)
      const { rows: acompteRows } = await client.query(
        `INSERT INTO acomptes_clients (
          tiers_id, montant, montant_restant, methode_paiement, notes,
          cree_par, magasin_id, session_caisse_id, reference_number, idempotency_key
        ) VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [tiersId, montant, methode_paiement, notes || null, userId, effectiveMagasinId, effectiveSessionId, reference_number || null, idempotency_key || null]
      );
      const acompte = acompteRows[0];

      // Record caisse movement when applicable. FAIL the transaction on error
      // — no swallow. Non-cash (carte/virement/etc.) tracked too for full breakdown.
      let mouvement: any = null;
      if (effectiveSessionId) {
        mouvement = await caisseMagasinService.enregistrerMouvement(client, {
          session_caisse_id: effectiveSessionId,
          type: 'encaissement',
          categorie: 'acompte_client',
          montant: Number(montant),
          methode_paiement,
          reference_type: 'acompte',
          reference_id: acompte.id,
          libelle: `Acompte client #${tiersId}`,
          user_id: userId,
          idempotency_key: idempotency_key ? `${idempotency_key}:mvt` : undefined,
        });

        await client.query(
          'UPDATE acomptes_clients SET mouvement_caisse_id = $1 WHERE id = $2',
          [mouvement.id, acompte.id]
        );
      }

      // Ledger entry (credit: client paid us)
      await client.query(
        `INSERT INTO compte_client_lignes
           (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
         VALUES ($1, 'acompte', $2, $3, 0, $4, $5, $6)`,
        [tiersId, acompte.id, `ACO-${acompte.id}`, montant, notes || null, userId]
      );

      await client.query('COMMIT');
      res.status(201).json({ success: true, data: { ...acompte, mouvement_caisse_id: mouvement?.id || null } });
    } catch (err: any) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  }

  static async recordAcompteFournisseur(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const tiersId = parseInt(req.params.id);
      const {
        montant,
        methode_paiement,
        notes,
        magasin_id,
        reference_number,
        session_caisse_id,
        idempotency_key,
      } = req.body;
      const userId = (req as any).user?.id || null;

      const VALID_METHODS = ['espece','carte','cheque','virement','mobile_money','orange_money','mtn_money','wave'];
      const CASH_METHODS = ['espece'];

      if (!montant || Number(montant) <= 0) {
        res.status(400).json({ success: false, error: 'Montant doit être > 0' });
        return;
      }
      if (!methode_paiement || !VALID_METHODS.includes(methode_paiement)) {
        res.status(400).json({ success: false, error: 'methode_paiement invalide' });
        return;
      }

      await client.query('BEGIN');

      // Idempotency short-circuit
      if (idempotency_key) {
        const { rows: dup } = await client.query(
          'SELECT * FROM acomptes_fournisseur WHERE idempotency_key = $1',
          [idempotency_key]
        );
        if (dup.length > 0) {
          await client.query('COMMIT');
          res.status(200).json({ success: true, data: dup[0], idempotent: true });
          return;
        }
      }

      // Validate tiers exists and is fournisseur-role
      const { rows: tiersRows } = await client.query(
        'SELECT id, est_fournisseur FROM tiers WHERE id = $1 AND deleted_at IS NULL',
        [tiersId]
      );
      if (tiersRows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ success: false, error: 'Tiers introuvable' });
        return;
      }
      if (tiersRows[0].est_fournisseur === false) {
        await client.query('ROLLBACK');
        res.status(422).json({ success: false, error: 'Tiers n\'est pas un fournisseur — promouvoir d\'abord' });
        return;
      }

      // Resolve target session for cash payments — FAIL HARD if no open session
      let effectiveSessionId: number | null = session_caisse_id || null;
      let effectiveMagasinId: number | null = magasin_id || null;

      if (CASH_METHODS.includes(methode_paiement)) {
        if (!effectiveSessionId) {
          if (!effectiveMagasinId) {
            await client.query('ROLLBACK');
            res.status(422).json({ success: false, error: 'magasin_id ou session_caisse_id requis pour paiement espèces' });
            return;
          }
          const { rows: sessRows } = await client.query(
            'SELECT id FROM sessions_caisse WHERE magasin_id = $1 AND statut = $2 LIMIT 1',
            [effectiveMagasinId, 'ouverte']
          );
          if (sessRows.length === 0) {
            await client.query('ROLLBACK');
            res.status(409).json({ success: false, error: 'Aucune session caisse ouverte pour ce magasin' });
            return;
          }
          effectiveSessionId = sessRows[0].id;
        } else {
          const { rows: sessRows } = await client.query(
            'SELECT magasin_id FROM sessions_caisse WHERE id = $1 AND statut = $2',
            [effectiveSessionId, 'ouverte']
          );
          if (sessRows.length === 0) {
            await client.query('ROLLBACK');
            res.status(409).json({ success: false, error: 'Session caisse non ouverte' });
            return;
          }
          effectiveMagasinId = effectiveMagasinId || sessRows[0].magasin_id;
        }
      }

      // Insert acompte (montant_restant = montant)
      const { rows: acompteRows } = await client.query(
        `INSERT INTO acomptes_fournisseur (
          tiers_id, montant, montant_restant, methode_paiement, notes,
          cree_par, magasin_id, session_caisse_id, reference_number, idempotency_key
        ) VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [tiersId, montant, methode_paiement, notes || null, userId, effectiveMagasinId, effectiveSessionId, reference_number || null, idempotency_key || null]
      );
      const acompte = acompteRows[0];

      // Record caisse movement when session attached — FAIL hard on error
      let mouvement: any = null;
      if (effectiveSessionId) {
        mouvement = await caisseMagasinService.enregistrerMouvement(client, {
          session_caisse_id: effectiveSessionId,
          type: 'decaissement',
          categorie: 'paiement_fournisseur',
          montant: Number(montant),
          methode_paiement,
          reference_type: 'acompte_fournisseur',
          reference_id: acompte.id,
          libelle: `Acompte fournisseur #${tiersId}`,
          user_id: userId || undefined,
          idempotency_key: idempotency_key ? `${idempotency_key}:mvt` : undefined,
        });

        await client.query(
          'UPDATE acomptes_fournisseur SET mouvement_caisse_id = $1 WHERE id = $2',
          [mouvement.id, acompte.id]
        );
      }

      // Ledger entry (debit: we paid the supplier — reduces AP)
      await client.query(
        `INSERT INTO compte_fournisseur_lignes
           (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
         VALUES ($1, 'acompte', $2, $3, $4, 0, $5, $6)`,
        [tiersId, acompte.id, `ACOF-${acompte.id}`, montant, notes || null, userId]
      );

      await client.query('COMMIT');
      res.status(201).json({ success: true, data: { ...acompte, mouvement_caisse_id: mouvement?.id || null } });
    } catch (err: any) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  }

  static async createCompensation(req: Request, res: Response): Promise<void> {
    try {
      const tiersId = parseInt(req.params.id);
      const result = await CompensationService.create({
        ...req.body,
        tiers_id: tiersId,
        cree_par: (req as any).user?.id,
      });
      res.status(201).json({ success: true, data: result });
    } catch (err: any) {
      const status = err.message?.includes('période') || err.message?.includes('rôle') || err.message?.includes('supérieur') ? 422 : 500;
      res.status(status).json({ success: false, error: err.message });
    }
  }

  static async getCompensations(req: Request, res: Response): Promise<void> {
    try {
      const tiersId = parseInt(req.params.id);
      const data = await CompensationService.getForTiers(tiersId);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async recomputeAllocation(req: Request, res: Response): Promise<void> {
    try {
      const tiersId = parseInt(req.params.id);
      const result = await TiersAllocationService.recomputeClientAllocations(tiersId);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

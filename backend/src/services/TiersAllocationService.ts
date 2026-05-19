import pool from '../db/connection';
import { logger } from '../utils/logger';

export interface AllocationResult {
  tiersId: number;
  facturesUpdated: number;
  surplus: number;
  totalPool: number;
  totalAllocated: number;
}

/**
 * FIFO allocation engine for client-side invoices.
 * Pools: paiements (date-constrained) + acomptes_clients (unconstrained).
 * Allocates oldest invoices first.
 */
export class TiersAllocationService {

  static async recomputeClientAllocations(tiersId: number, options: { transaction?: any } = {}): Promise<AllocationResult> {
    const db = options.transaction || pool;

    try {
      const { rows: factures } = await db.query(
        `SELECT id, total, COALESCE(montant_paye,0) as montant_paye, statut, date_facture
         FROM factures
         WHERE tiers_id=$1 AND statut!='annulee' AND deleted_at IS NULL
         ORDER BY date_facture ASC, id ASC FOR UPDATE`,
        [tiersId]
      );

      const { rows: paiements } = await db.query(
        `SELECT p.id, p.montant, p.date_paiement, f.date_facture
         FROM paiements p
         JOIN factures f ON f.id=p.facture_id
         WHERE f.tiers_id=$1 AND f.deleted_at IS NULL
         ORDER BY p.date_paiement ASC, p.id ASC`,
        [tiersId]
      );

      await db.query(
        `UPDATE acomptes_clients
         SET statut='disponible', facture_id_applique=NULL, date_utilisation=NULL
         WHERE tiers_id=$1 AND statut='utilise'`,
        [tiersId]
      );

      for (const f of factures) {
        await db.query(
          `UPDATE factures SET montant_paye=0, remaining_due=total,
           statut=CASE WHEN statut='annulee' THEN statut ELSE 'en_attente' END WHERE id=$1`,
          [f.id]
        );
      }

      const { rows: acomptes } = await db.query(
        `SELECT id, montant, date_acompte FROM acomptes_clients
         WHERE tiers_id=$1 AND statut='disponible'
         ORDER BY date_acompte ASC, id ASC`,
        [tiersId]
      );

      interface Fund { id: number; montant: number; date: string; type: 'paiement' | 'acompte'; remaining: number; }

      const funds: Fund[] = [
        ...paiements.map((p: any) => ({ id: p.id, montant: parseFloat(p.montant), date: p.date_paiement, type: 'paiement' as const, remaining: parseFloat(p.montant) })),
        ...acomptes.map((a: any) => ({ id: a.id, montant: parseFloat(a.montant), date: a.date_acompte, type: 'acompte' as const, remaining: parseFloat(a.montant) })),
      ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id - b.id);

      let totalPool = funds.reduce((s, f) => s + f.montant, 0);
      let totalAllocated = 0;
      const allocatedAcomptes: { id: number; montant: number; facture_id: number }[] = [];

      for (const facture of factures) {
        if (totalPool <= 0) break;
        const factureTotal = parseFloat(facture.total);
        let allocated = 0;

        for (const fund of funds) {
          if (fund.remaining <= 0) continue;
          if (allocated >= factureTotal) break;
          if (fund.type === 'paiement' && new Date(fund.date) < new Date(facture.date_facture)) continue;

          const toAllocate = Math.min(fund.remaining, factureTotal - allocated);
          fund.remaining -= toAllocate;
          allocated += toAllocate;
          totalPool -= toAllocate;
          totalAllocated += toAllocate;

          if (fund.type === 'acompte') {
            const ex = allocatedAcomptes.find(a => a.id === fund.id && a.facture_id === facture.id);
            if (ex) ex.montant += toAllocate;
            else allocatedAcomptes.push({ id: fund.id, montant: toAllocate, facture_id: facture.id });
          }
        }

        const newStatut = allocated <= 0 ? 'en_attente' : allocated < factureTotal ? 'partielle' : 'payee';
        await db.query(
          `UPDATE factures SET montant_paye=$1, remaining_due=$2, statut=$3 WHERE id=$4`,
          [allocated, factureTotal - allocated, newStatut, facture.id]
        );
      }

      for (const alloc of allocatedAcomptes) {
        await db.query(
          `UPDATE acomptes_clients SET statut='utilise', facture_id_applique=$1, date_utilisation=NOW() WHERE id=$2`,
          [alloc.facture_id, alloc.id]
        );
      }

      const { rows: soldeRows } = await db.query(
        `SELECT COALESCE(SUM(remaining_due),0) as solde FROM factures
         WHERE tiers_id=$1 AND statut!='annulee' AND deleted_at IS NULL`,
        [tiersId]
      );
      await db.query(
        `UPDATE tiers SET solde_client_actuel=$1 WHERE id=$2`,
        [parseFloat(soldeRows[0].solde), tiersId]
      );

      const result: AllocationResult = {
        tiersId,
        facturesUpdated: factures.length,
        surplus: Math.round(totalPool),
        totalPool: Math.round(paiements.reduce((s: number, p: any) => s + parseFloat(p.montant), 0) + acomptes.reduce((s: number, a: any) => s + parseFloat(a.montant), 0)),
        totalAllocated: Math.round(totalAllocated),
      };

      logger.info('Tiers client allocation recomputed', { tiersId, result } as any);
      return result;

    } catch (err) {
      logger.error({ err, tiersId }, 'Error recomputing client allocations for tiers');
      throw err;
    }
  }

  static async recomputeAllAllocations(): Promise<{ tiersProcessed: number; facturesUpdated: number; msElapsed: number }> {
    const start = Date.now();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT DISTINCT tiers_id FROM factures WHERE deleted_at IS NULL`
      );
      let total = 0;
      for (const row of rows) {
        const r = await this.recomputeClientAllocations(row.tiers_id, { transaction: client });
        total += r.facturesUpdated;
      }
      await client.query('COMMIT');
      return { tiersProcessed: rows.length, facturesUpdated: total, msElapsed: Date.now() - start };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

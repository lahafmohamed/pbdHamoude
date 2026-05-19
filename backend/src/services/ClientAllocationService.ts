import pool from '../db/connection';
import { logger } from '../utils/logger';

export interface AllocationResult {
  clientId: number;
  facturesUpdated: number;
  surplus: number;
  totalPool: number;
  totalAllocated: number;
}

export class ClientAllocationService {

  /**
   * Recompute FIFO allocation for a client
   * Updates factures.montant_paye and factures.statut based on FIFO rule
   */
  static async recomputeClientAllocations(clientId: number, options: { transaction?: any } = {}): Promise<AllocationResult> {
    const client = options.transaction || pool;
    
    try {
      // 1. Load non-cancelled factures for client, sorted by date ASC, id ASC
      const { rows: factures } = await client.query(
        `SELECT id, total, COALESCE(montant_paye, 0) as montant_paye, statut, date_facture
         FROM factures
         WHERE tiers_id = $1 AND statut != 'annulee' AND deleted_at IS NULL
         ORDER BY date_facture ASC, id ASC
         FOR UPDATE`,
        [clientId]
      );

      // 2. Load paiements for client, sorted by date ASC, id ASC
      const { rows: paiements } = await client.query(
        `SELECT p.id, p.montant, p.date_paiement, f.date_facture
         FROM paiements p
         JOIN factures f ON f.id = p.facture_id
         WHERE f.tiers_id = $1 AND f.deleted_at IS NULL
         ORDER BY p.date_paiement ASC, p.id ASC`,
        [clientId]
      );

      // 3a. Reset acomptes back to 'disponible' for this client (idempotent recompute)
      await client.query(
        `UPDATE acomptes_clients
         SET statut = 'disponible', facture_id_applique = NULL, date_utilisation = NULL
         WHERE tiers_id = $1 AND statut = 'utilise'`,
        [clientId]
      );

      // 3b. Reset factures.montant_paye = 0 for this client
      for (const facture of factures) {
        await client.query(
          'UPDATE factures SET montant_paye = 0, remaining_due = total, statut = CASE WHEN statut = \'annulee\' THEN statut ELSE \'en_attente\' END WHERE id = $1',
          [facture.id]
        );
      }

      // 3c. Load available acomptes (now includes any that were just reset)
      const { rows: acomptes } = await client.query(
        `SELECT id, montant, date_acompte
         FROM acomptes_clients
         WHERE tiers_id = $1 AND statut = 'disponible'
         ORDER BY date_acompte ASC, id ASC`,
        [clientId]
      );

      // 4. Build combined fund pool (payments + acomptes) with remaining tracking
      interface FundItem {
        id: number;
        montant: number;
        date: string;
        type: 'paiement' | 'acompte';
        remaining: number;
      }

      const funds: FundItem[] = [
        ...paiements.map((p: any) => ({
          id: p.id,
          montant: parseFloat(p.montant),
          date: p.date_paiement,
          type: 'paiement' as const,
          remaining: parseFloat(p.montant),
        })),
        ...acomptes.map((a: any) => ({
          id: a.id,
          montant: parseFloat(a.montant),
          date: a.date_acompte,
          type: 'acompte' as const,
          remaining: parseFloat(a.montant),
        }))
      ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id - b.id);

      let totalPool = funds.reduce((sum, f) => sum + f.montant, 0);
      let totalAllocated = 0;
      const allocatedAcomptes: { id: number; montant: number; facture_id: number }[] = [];

      for (const facture of factures) {
        if (totalPool <= 0) break;

        const factureTotal = parseFloat(facture.total);
        let factureAllocated = 0;

        // Allocate from funds in FIFO order
        for (const fund of funds) {
          if (fund.remaining <= 0) continue;
          if (factureAllocated >= factureTotal) break;

          // For regular payments: enforce chronological constraint (payment must be on/after invoice date)
          if (fund.type === 'paiement' && new Date(fund.date) < new Date(facture.date_facture)) {
            continue;
          }

          // Acomptes can be applied to any invoice (no chronological constraint)
          const toAllocate = Math.min(fund.remaining, factureTotal - factureAllocated);

          fund.remaining -= toAllocate;
          factureAllocated += toAllocate;
          totalPool -= toAllocate;
          totalAllocated += toAllocate;

          if (fund.type === 'acompte') {
            const existing = allocatedAcomptes.find(a => a.id === fund.id && a.facture_id === facture.id);
            if (existing) {
              existing.montant += toAllocate;
            } else {
              allocatedAcomptes.push({ id: fund.id, montant: toAllocate, facture_id: facture.id });
            }
          }
        }

        // Update facture with allocation
        const newStatut = this.deriveStatut(factureAllocated, factureTotal);

        await client.query(
          `UPDATE factures
           SET montant_paye = $1, remaining_due = $2, statut = $3
           WHERE id = $4`,
          [factureAllocated, factureTotal - factureAllocated, newStatut, facture.id]
        );
      }

      // 5. Update allocated acomptes status
      for (const alloc of allocatedAcomptes) {
        await client.query(
          `UPDATE acomptes_clients
           SET statut = 'utilise', facture_id_applique = $1, date_utilisation = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [alloc.facture_id, alloc.id]
        );
      }

      // 6. Sync tiers.solde_client_actuel from authoritative source
      const { rows: soldeRows } = await client.query(
        `SELECT COALESCE(SUM(remaining_due), 0) as solde
         FROM factures
         WHERE tiers_id = $1 AND statut != 'annulee' AND deleted_at IS NULL`,
        [clientId]
      );
      await client.query(
        'UPDATE tiers SET solde_client_actuel = $1 WHERE id = $2',
        [parseFloat(soldeRows[0].solde), clientId]
      );

      const surplus = totalPool;

      const result: AllocationResult = {
        clientId,
        facturesUpdated: factures.length,
        surplus: Math.round(surplus),
        totalPool: Math.round(paiements.reduce((sum: number, p: any) => sum + parseFloat(p.montant), 0) + acomptes.reduce((sum: number, a: any) => sum + parseFloat(a.montant), 0)),
        totalAllocated: Math.round(totalAllocated)
      };

      logger.info('Client allocation recomputed', { clientId, result } as any);
      return result;

    } catch (error) {
      logger.error({ err: error, clientId }, 'Error recomputing client allocations');
      throw error;
    }
  }

  /**
   * Derive statut from payment vs total
   */
  private static deriveStatut(montantPaye: number, total: number): string {
    if (montantPaye <= 0) return 'en_attente';
    if (montantPaye < total) return 'partielle';
    return 'payee';
  }

  /**
   * Recompute allocations for all clients (admin endpoint)
   */
  static async recomputeAllAllocations(): Promise<{ 
    clientsProcessed: number; 
    facturesUpdated: number; 
    msElapsed: number;
    summary: AllocationResult[];
  }> {
    const startTime = Date.now();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      const { rows: clients } = await client.query(
        'SELECT DISTINCT tiers_id FROM factures WHERE deleted_at IS NULL AND tiers_id IS NOT NULL'
      );

      const summary: AllocationResult[] = [];
      let totalFacturesUpdated = 0;

      for (const clientRow of clients) {
        const clientId = clientRow.tiers_id;
        try {
          const result = await this.recomputeClientAllocations(clientId, { transaction: client });
          summary.push(result);
          totalFacturesUpdated += result.facturesUpdated;
        } catch (error) {
          logger.error({ err: error, clientId }, 'Failed to recompute allocations for client');
          // Continue with other clients
        }
      }

      await client.query('COMMIT');

      const msElapsed = Date.now() - startTime;
      
      return {
        clientsProcessed: clients.length,
        facturesUpdated: totalFacturesUpdated,
        msElapsed,
        summary
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Test allocation for a specific client (returns result without persisting)
   */
  static async testAllocation(clientId: number): Promise<AllocationResult & { factures: any[] }> {
    const client = await pool.connect();
    
    try {
      // Load data without locks
      const { rows: factures } = await client.query(
        `SELECT id, numero_facture, total, COALESCE(montant_paye, 0) as montant_paye, statut, date_facture
         FROM factures
         WHERE tiers_id = $1 AND statut != 'annulee' AND deleted_at IS NULL
         ORDER BY date_facture ASC, id ASC`,
        [clientId]
      );

      const { rows: paiements } = await client.query(
        `SELECT p.id, p.montant, p.date_paiement, f.date_facture, f.numero_facture
         FROM paiements p
         JOIN factures f ON f.id = p.facture_id
         WHERE f.tiers_id = $1 AND f.deleted_at IS NULL
         ORDER BY p.date_paiement ASC, p.id ASC`,
        [clientId]
      );

      const { rows: acomptes } = await client.query(
        `SELECT id, montant, date_acompte
         FROM acomptes_clients
         WHERE tiers_id = $1 AND statut = 'disponible'
         ORDER BY date_acompte ASC, id ASC`,
        [clientId]
      );

      // Simulate allocation
      interface SimFundItem {
        id: number;
        montant: number;
        date: string;
        type: 'paiement' | 'acompte';
        remaining: number;
      }

      const funds: SimFundItem[] = [
        ...paiements.map((p: any) => ({
          id: p.id,
          montant: parseFloat(p.montant),
          date: p.date_paiement,
          type: 'paiement' as const,
          remaining: parseFloat(p.montant),
        })),
        ...acomptes.map((a: any) => ({
          id: a.id,
          montant: parseFloat(a.montant),
          date: a.date_acompte,
          type: 'acompte' as const,
          remaining: parseFloat(a.montant),
        }))
      ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id - b.id);

      let totalPool = funds.reduce((sum, f) => sum + f.montant, 0);
      let totalAllocated = 0;
      const simulatedFactures = [];

      for (const facture of factures) {
        if (totalPool <= 0) break;

        const factureTotal = parseFloat(facture.total);
        let factureAllocated = 0;

        for (const fund of funds) {
          if (fund.remaining <= 0) continue;
          if (factureAllocated >= factureTotal) break;

          if (fund.type === 'paiement' && new Date(fund.date) < new Date(facture.date_facture)) {
            continue;
          }

          const toAllocate = Math.min(fund.remaining, factureTotal - factureAllocated);

          fund.remaining -= toAllocate;
          factureAllocated += toAllocate;
          totalPool -= toAllocate;
          totalAllocated += toAllocate;
        }

        const newStatut = this.deriveStatut(factureAllocated, factureTotal);

        simulatedFactures.push({
          ...facture,
          new_montant_paye: factureAllocated,
          new_statut: newStatut,
          allocated: factureAllocated
        });
      }

      // Add remaining factures with no allocation
      for (let i = simulatedFactures.length; i < factures.length; i++) {
        simulatedFactures.push({
          ...factures[i],
          new_montant_paye: 0,
          new_statut: 'en_attente',
          allocated: 0
        });
      }

      const surplus = totalPool;

      return {
        clientId,
        facturesUpdated: factures.length,
        surplus: Math.round(surplus),
        totalPool: Math.round(paiements.reduce((sum, p) => sum + parseFloat(p.montant), 0) + acomptes.reduce((sum, a) => sum + parseFloat(a.montant), 0)),
        totalAllocated: Math.round(totalAllocated),
        factures: simulatedFactures
      };

    } finally {
      client.release();
    }
  }
}

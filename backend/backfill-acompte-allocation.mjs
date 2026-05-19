/**
 * backfill-acompte-allocation.mjs
 * One-shot backfill: recomputes FIFO allocation for every client that has
 * at least one acompte, so existing acomptes are applied to open invoices.
 * Safe to run multiple times (idempotent).
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

// ── Inline FIFO engine (mirrors ClientAllocationService.recomputeClientAllocations) ──

function deriveStatut(montantPaye, total) {
  if (montantPaye <= 0) return 'en_attente';
  if (montantPaye < total) return 'partielle';
  return 'payee';
}

async function recomputeClient(db, clientId) {
  // 1. Lock factures
  const { rows: factures } = await db.query(
    `SELECT id, total, COALESCE(montant_paye, 0) as montant_paye, statut, date_facture
     FROM factures
     WHERE client_id = $1 AND statut != 'annulee' AND deleted_at IS NULL
     ORDER BY date_facture ASC, id ASC
     FOR UPDATE`,
    [clientId]
  );

  // 2. Load paiements
  const { rows: paiements } = await db.query(
    `SELECT p.id, p.montant, p.date_paiement, f.date_facture
     FROM paiements p
     JOIN factures f ON f.id = p.facture_id
     WHERE f.client_id = $1 AND f.deleted_at IS NULL
     ORDER BY p.date_paiement ASC, p.id ASC`,
    [clientId]
  );

  // 3a. Reset acomptes → disponible (idempotent)
  await db.query(
    `UPDATE acomptes_clients
     SET statut = 'disponible', facture_id_applique = NULL, date_utilisation = NULL
     WHERE client_id = $1 AND statut = 'utilise'`,
    [clientId]
  );

  // 3b. Reset factures
  for (const f of factures) {
    await db.query(
      `UPDATE factures SET montant_paye = 0, remaining_due = total,
       statut = CASE WHEN statut = 'annulee' THEN statut ELSE 'en_attente' END
       WHERE id = $1`,
      [f.id]
    );
  }

  // 3c. Load acomptes (now all disponible after reset)
  const { rows: acomptes } = await db.query(
    `SELECT id, montant, date_acompte
     FROM acomptes_clients
     WHERE client_id = $1 AND statut = 'disponible'
     ORDER BY date_acompte ASC, id ASC`,
    [clientId]
  );

  // 4. Build fund pool
  const funds = [
    ...paiements.map(p => ({
      id: p.id, montant: parseFloat(p.montant), date: p.date_paiement,
      type: 'paiement', remaining: parseFloat(p.montant),
    })),
    ...acomptes.map(a => ({
      id: a.id, montant: parseFloat(a.montant), date: a.date_acompte,
      type: 'acompte', remaining: parseFloat(a.montant),
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date) || a.id - b.id);

  let totalPool = funds.reduce((s, f) => s + f.montant, 0);
  let totalAllocated = 0;
  const allocatedAcomptes = [];

  for (const facture of factures) {
    if (totalPool <= 0) break;
    const factureTotal = parseFloat(facture.total);
    let factureAllocated = 0;

    for (const fund of funds) {
      if (fund.remaining <= 0) continue;
      if (factureAllocated >= factureTotal) break;
      if (fund.type === 'paiement' && new Date(fund.date) < new Date(facture.date_facture)) continue;

      const toAllocate = Math.min(fund.remaining, factureTotal - factureAllocated);
      fund.remaining -= toAllocate;
      factureAllocated += toAllocate;
      totalPool -= toAllocate;
      totalAllocated += toAllocate;

      if (fund.type === 'acompte') {
        const existing = allocatedAcomptes.find(a => a.id === fund.id && a.facture_id === facture.id);
        if (existing) existing.montant += toAllocate;
        else allocatedAcomptes.push({ id: fund.id, montant: toAllocate, facture_id: facture.id });
      }
    }

    const newStatut = deriveStatut(factureAllocated, factureTotal);
    await db.query(
      `UPDATE factures SET montant_paye = $1, remaining_due = $2, statut = $3 WHERE id = $4`,
      [factureAllocated, factureTotal - factureAllocated, newStatut, facture.id]
    );
  }

  // 5. Mark allocated acomptes as utilise
  for (const alloc of allocatedAcomptes) {
    await db.query(
      `UPDATE acomptes_clients
       SET statut = 'utilise', facture_id_applique = $1, date_utilisation = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [alloc.facture_id, alloc.id]
    );
  }

  return {
    factures: factures.length,
    paiements: paiements.length,
    acomptes: acomptes.length,
    totalPool: Math.round(paiements.reduce((s, p) => s + parseFloat(p.montant), 0) + acomptes.reduce((s, a) => s + parseFloat(a.montant), 0)),
    totalAllocated: Math.round(totalAllocated),
    surplus: Math.round(totalPool),
    allocatedAcomptes: allocatedAcomptes.length,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = await pool.connect();
  try {
    // Get all clients with at least one acompte
    const { rows: clients } = await db.query(
      `SELECT DISTINCT client_id FROM acomptes_clients ORDER BY client_id`
    );

    if (clients.length === 0) {
      console.log('ℹ️  Aucun acompte trouvé — rien à faire.');
      return;
    }

    console.log(`🔄 Recomputing allocations for ${clients.length} client(s) with acomptes...\n`);

    let totalFactures = 0;
    let totalAcomptesAllocated = 0;
    let errors = 0;

    for (const { client_id: clientId } of clients) {
      try {
        await db.query('BEGIN');
        const result = await recomputeClient(db, clientId);
        await db.query('COMMIT');

        totalFactures += result.factures;
        totalAcomptesAllocated += result.allocatedAcomptes;

        console.log(`  ✅ Client ${clientId}: ${result.factures} facture(s), pool=${result.totalPool.toLocaleString()} | alloué=${result.totalAllocated.toLocaleString()} | surplus=${result.surplus.toLocaleString()} | acomptes_alloués=${result.allocatedAcomptes}`);
      } catch (err) {
        await db.query('ROLLBACK');
        errors++;
        console.error(`  ❌ Client ${clientId}: ${err.message}`);
      }
    }

    console.log(`\n✅ Backfill terminé.`);
    console.log(`   Clients traités : ${clients.length - errors}/${clients.length}`);
    console.log(`   Factures mises à jour : ${totalFactures}`);
    console.log(`   Acomptes alloués : ${totalAcomptesAllocated}`);
    if (errors > 0) console.log(`   Erreurs : ${errors}`);

  } finally {
    db.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * detect-caisse-orphans.mjs
 *
 * Reports cash money-events (acomptes + paiements) that lack a mouvements_caisse link.
 * Read-only. Run before VALIDATE on chk_paiement_espece_* constraints from migration 050.
 *
 * Usage:  node detect-caisse-orphans.mjs
 *         node detect-caisse-orphans.mjs --link    # attempt safe relinking
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const DO_LINK = process.argv.includes('--link');

async function main() {
  const client = await pool.connect();
  try {
    console.log('=== Caisse orphan audit ===\n');

    const { rows: summary } = await client.query(`
      SELECT source_kind, COUNT(*) AS n, COALESCE(SUM(montant),0) AS total
      FROM v_caisse_audit WHERE is_orphan
      GROUP BY source_kind ORDER BY source_kind
    `);

    if (summary.length === 0) {
      console.log('No orphans detected. Safe to VALIDATE constraints.');
      return;
    }

    console.table(summary);

    const { rows: details } = await client.query(`
      SELECT source_kind, source_id, tiers_id, montant, methode_paiement,
             source_date, session_caisse_id
      FROM v_caisse_audit
      WHERE is_orphan
      ORDER BY source_date DESC
      LIMIT 50
    `);
    console.log('\nMost recent orphans (max 50):');
    console.table(details);

    if (!DO_LINK) {
      console.log('\nRe-run with --link to attempt safe relinking.');
      console.log('Relinking only matches paiements ↔ mouvements_caisse on');
      console.log('(session_caisse_id, montant, methode_paiement, ±60s window).');
      return;
    }

    // Safe relink: paiements with session set but no mouvement_caisse_id,
    // where exactly ONE candidate mouvement matches.
    console.log('\n=== Attempting relink (paiements only) ===');
    await client.query('BEGIN');

    const { rows: candidates } = await client.query(`
      SELECT p.id AS paiement_id, p.session_caisse_id, p.montant,
             p.methode_paiement, p.date_paiement
      FROM paiements p
      WHERE p.methode_paiement = 'espece'
        AND p.source = 'direct'
        AND p.session_caisse_id IS NOT NULL
        AND p.mouvement_caisse_id IS NULL
        AND p.deleted_at IS NULL
    `);

    let linked = 0, skipped = 0;
    for (const c of candidates) {
      const { rows: matches } = await client.query(
        `SELECT id FROM mouvements_caisse
         WHERE session_caisse_id = $1
           AND montant = $2
           AND methode_paiement = $3
           AND type = 'encaissement'
           AND (reference_type = 'paiement' AND reference_id = $4
                OR reference_type IS NULL)
           AND ABS(EXTRACT(EPOCH FROM (date_mouvement - $5))) < 60`,
        [c.session_caisse_id, c.montant, c.methode_paiement, c.paiement_id, c.date_paiement]
      );
      if (matches.length === 1) {
        await client.query(
          'UPDATE paiements SET mouvement_caisse_id = $1 WHERE id = $2',
          [matches[0].id, c.paiement_id]
        );
        linked++;
      } else {
        skipped++;
      }
    }

    await client.query('COMMIT');
    console.log(`Linked: ${linked}    Skipped (ambiguous/none): ${skipped}`);
    console.log('\nRemaining orphans require manual review or re-running with VALIDATE NOT VALID.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();

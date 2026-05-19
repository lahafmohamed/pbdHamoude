import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

// Check recent compensations
const { rows: comps } = await pool.query(
  `SELECT * FROM compensations ORDER BY created_at DESC LIMIT 3`
);
console.log('=== Recent compensations ===');
comps.forEach(r => console.log(JSON.stringify(r)));

// Check recent acomptes with compensation method
const { rows: acs } = await pool.query(
  `SELECT id, tiers_id, montant, montant_restant, methode_paiement, statut, date_acompte
   FROM acomptes_clients WHERE methode_paiement = 'compensation' ORDER BY created_at DESC LIMIT 5`
);
console.log('\n=== Acomptes compensation ===');
acs.forEach(r => console.log(JSON.stringify(r)));

// Check facture FAC-2026-00227
const { rows: facs } = await pool.query(
  `SELECT id, numero_facture, tiers_id, total, montant_paye, remaining_due, statut
   FROM factures WHERE numero_facture = 'FAC-2026-00227'`
);
console.log('\n=== Facture FAC-2026-00227 ===');
facs.forEach(r => console.log(JSON.stringify(r)));

await pool.end();

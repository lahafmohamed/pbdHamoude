const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

async function test() {
  const m = await pool.query(`SELECT id, location_id, nom FROM magasins LIMIT 3`);
  console.log('magasins:', m.rows);

  const f = await pool.query(`SELECT id, location_id, numero_facture FROM factures LIMIT 3`);
  console.log('factures:', f.rows);

  const p = await pool.query(`SELECT id, facture_id, montant, methode_paiement, session_caisse_id FROM paiements LIMIT 3`);
  console.log('paiements:', p.rows);

  const mc = await pool.query(`SELECT id, session_caisse_id, montant, type, categorie FROM mouvements_caisse LIMIT 5`);
  console.log('mouvements_caisse:', mc.rows);

  await pool.end();
}
test().catch(e => { console.error(e); pool.end(); });

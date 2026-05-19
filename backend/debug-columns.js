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
  const res = await pool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'acomptes_clients' AND column_name IN ('session_caisse_id', 'magasin_id', 'location_id')
  `);
  console.log('colonnes acomptes_clients:', res.rows);

  // Vérifier si factures ont des données de test
  const f = await pool.query(`SELECT COUNT(*) as c FROM factures`);
  console.log('nb factures:', f.rows[0].c);

  await pool.end();
}
test().catch(e => { console.error(e); pool.end(); });

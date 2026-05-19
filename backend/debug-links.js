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
  // Vérifie si factures a location_id ou magasin_id
  const res = await pool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'factures' AND column_name IN ('location_id', 'magasin_id')
  `);
  console.log('colonnes factures:', res.rows);

  // Vérifie si paiements a session_caisse_id
  const res2 = await pool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'paiements' AND column_name IN ('session_caisse_id', 'magasin_id', 'location_id')
  `);
  console.log('colonnes paiements:', res2.rows);

  // Vérifie si acomptes_clients a liens caisse
  const res3 = await pool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'acomptes_clients' AND column_name IN ('session_caisse_id', 'magasin_id', 'location_id')
  `);
  console.log('colonnes acomptes_clients:', res3.rows);

  await pool.end();
}
test().catch(e => { console.error(e); pool.end(); });

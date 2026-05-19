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
  const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'mouvements_caisse' ORDER BY ordinal_position`);
  console.log('Colonnes mouvements_caisse:');
  res.rows.forEach(c => console.log(' -', c.column_name));

  // Vérifier si il y a des données
  const data = await pool.query('SELECT * FROM mouvements_caisse LIMIT 2');
  console.log('\nSample data:', data.rows);

  await pool.end();
}
test().catch(e => { console.error(e); pool.end(); });

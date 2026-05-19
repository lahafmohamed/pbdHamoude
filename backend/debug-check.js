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
  const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions_caisse' ORDER BY ordinal_position`);
  console.log('Colonnes sessions_caisse:');
  res.rows.forEach(c => console.log(' -', c.column_name));
  await pool.end();
}
test().catch(e => { console.error(e); pool.end(); });

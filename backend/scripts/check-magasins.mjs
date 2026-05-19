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

const { rows } = await pool.query(`SELECT id, code, nom, actif, location_id FROM magasins ORDER BY id`);
console.log('=== magasins ===');
if (rows.length === 0) {
  console.log('  (aucun magasin en base)');
} else {
  rows.forEach(r => console.log(JSON.stringify(r)));
}

const { rows: locs } = await pool.query(`SELECT id, nom, type FROM stock_locations WHERE type = 'magasin' ORDER BY id`);
console.log('\n=== stock_locations type=magasin ===');
locs.forEach(r => console.log(JSON.stringify(r)));

await pool.end();

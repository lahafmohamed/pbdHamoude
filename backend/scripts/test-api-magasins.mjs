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

// Simulate getMagasinsForUser query
const { rows } = await pool.query(
  `SELECT m.*, sl.nom as location_nom
   FROM magasins m
   LEFT JOIN stock_locations sl ON m.location_id = sl.id
   WHERE m.actif = true
   ORDER BY m.code`
);
console.log('getMagasinsForUser result:', JSON.stringify(rows, null, 2));

await pool.end();

import fs from 'fs';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'magasin_db',
  password: process.env.DB_PASSWORD || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
  try {
    const sql = fs.readFileSync('src/db/057_user_permission_overrides.sql', 'utf8');
    await pool.query(sql);
    console.log('Migration 057_user_permission_overrides.sql executed successfully.');
  } catch (err) {
    console.error('Error executing migration:', err);
  } finally {
    await pool.end();
  }
}
run();

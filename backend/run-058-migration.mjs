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
    const sql = fs.readFileSync('src/db/058_sync_permissions_with_pages.sql', 'utf8');
    await pool.query(sql);
    console.log('Migration 058_sync_permissions_with_pages.sql executed successfully.');
  } catch (err) {
    console.error('Error executing migration:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
run();

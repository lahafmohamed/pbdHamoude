import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});
const client = await pool.connect();
try {
  await client.query('ALTER TABLE factures_avoir ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP');
  await client.query('CREATE INDEX IF NOT EXISTS idx_factures_avoir_deleted_at ON factures_avoir(deleted_at)');
  console.log('Done');
} catch (e) {
  console.error(e.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}

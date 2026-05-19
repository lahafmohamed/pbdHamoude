// Phase 3 database migrations
// Run with: node setup-phase3.mjs
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

async function runMigrations() {
  const migrationFiles = ['007_receptions.sql', '008_retours.sql'];
  const client = await pool.connect();

  try {
    console.log('🔧 Applying Phase 3 migrations...\n');
    await client.query('BEGIN');

    for (const file of migrationFiles) {
      console.log(`📦 Applying ${file}...`);
      const sql = fs.readFileSync(path.join(__dirname, 'src', 'db', file), 'utf8');
      await client.query(sql);
      console.log(`✅ ${file} applied\n`);
    }

    await client.query('COMMIT');
    console.log('🎉 Phase 3 migrations complete!\n');
    console.log('New features:');
    console.log('  📦 Receptions (Purchase Receipt workflow)');
    console.log('  🔄 Returns (Customer Returns management)');
    console.log('  📊 Barcode support on products');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    if (error.detail) console.error('Detail:', error.detail);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();

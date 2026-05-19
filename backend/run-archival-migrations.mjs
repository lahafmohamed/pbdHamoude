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

const migrations = [
  { path: path.join(__dirname, 'migrations', 'archive_three_way_match_tables.sql') },
  { path: path.join(__dirname, 'src', 'db', '055_archive_internal_stock_requests.sql') }
];

async function run() {
  const client = await pool.connect();
  try {
    for (const migration of migrations) {
      if (!fs.existsSync(migration.path)) {
        console.log(`⚠️  Skipping missing file: ${migration.path}`);
        continue;
      }
      const sql = fs.readFileSync(migration.path, 'utf-8');
      console.log(`▶️  Running ${path.basename(migration.path)}...`);
      await client.query(sql);
      console.log(`✅ ${path.basename(migration.path)} done`);
    }
    console.log('\n🎉 Archival migrations completed');
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

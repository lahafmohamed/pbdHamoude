// Setup database with all Phase 1 migrations
// Run with: node setup-phase1.mjs
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
  const migrationFiles = [
    '004_auth.sql',
    '005_soft_deletes.sql',
    '006_sequences.sql',
  ];

  // Also enable the stock movement trigger
  const triggerFile = '002_mouvements_stock.sql';

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Run trigger migration first (if not already applied)
    console.log('📦 Applying stock movement trigger...');
    const triggerSql = fs.readFileSync(path.join(__dirname, 'db', triggerFile), 'utf8');
    // Only run the CREATE TRIGGER part
    const triggerPart = triggerSql.split('-- Trigger sur les produits')[1];
    if (triggerPart) {
      await client.query(triggerPart);
      console.log('✅ Stock movement trigger enabled');
    }

    // Run each migration
    for (const file of migrationFiles) {
      console.log(`📦 Applying ${file}...`);
      const sql = fs.readFileSync(path.join(__dirname, 'db', file), 'utf8');
      await client.query(sql);
      console.log(`✅ ${file} applied`);
    }

    await client.query('COMMIT');
    console.log('\n🎉 All Phase 1 migrations applied successfully!');
    console.log('\nDefault users created:');
    console.log('  admin / admin123');
    console.log('  manager / manager123');
    console.log('  caissier / caissier123');
    console.log('\n⚠️  Change these passwords after first login!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();

// Fix script to apply missing Phase 3 migration
// Run with: node fix-missing-tables.mjs
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

async function fixMissingTables() {
  const client = await pool.connect();

  try {
    console.log('🔧 Applying missing Phase 3 migration...\n');
    await client.query('BEGIN');

    // Apply migration 013 - Phase 3 Retail Operations
    console.log('📦 Applying 013_phase3_retail.sql...');
    const sql = fs.readFileSync(
      path.join(__dirname, 'src', 'db', '013_phase3_retail.sql'),
      'utf8'
    );
    await client.query(sql);
    console.log('✅ Migration 013 applied successfully\n');

    // Verify user_sessions table exists
    console.log('🔍 Verifying user_sessions table...');
    const { rows } = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'user_sessions'
      ORDER BY ordinal_position
    `);
    
    if (rows.length > 0) {
      console.log('✅ user_sessions table verified with columns:');
      rows.forEach(row => console.log(`   - ${row.column_name} (${row.data_type})`));
    } else {
      console.log('❌ user_sessions table not found!');
    }

    await client.query('COMMIT');
    console.log('\n🎉 Fix complete! Login should now work.\n');
    console.log('═══════════════════════════════════════');
    console.log('Test login with:');
    console.log('  admin / admin123');
    console.log('  manager / manager123');
    console.log('  caissier / caissier123');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Fix failed:', error.message);
    if (error.detail) console.error('Detail:', error.detail);
    if (error.hint) console.error('Hint:', error.hint);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

fixMissingTables();

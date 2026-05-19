const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

async function runMigration(filename) {
  const filePath = path.join(__dirname, 'src', 'db', filename);
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(filePath, 'utf8');
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📦 Running migration: ${filename}`);
  console.log('='.repeat(80));

  try {
    await pool.query(sql);
    console.log(`✅ Successfully applied: ${filename}`);
  } catch (error) {
    console.error(`❌ Error applying ${filename}:`, error.message);
    if (error.position) {
      const lines = sql.split('\n');
      const lineNum = parseInt(error.position) > 0 ? 
        sql.substring(0, parseInt(error.position)).split('\n').length : 'unknown';
      console.error(`   Position: Line ${lineNum}`);
    }
    console.error('\n💡 Tip: You may need to run this migration manually with psql to see full details');
  }
}

async function main() {
  const migrations = process.argv.slice(2);
  
  if (migrations.length === 0) {
    console.log('Usage: node run-migration.js <migration-file> [migration-file2...]');
    console.log('\nExample: node run-migration.js 021_phase5_quick_wins.sql');
    process.exit(0);
  }

  console.log('🚀 Starting database migrations...\n');

  for (const migration of migrations) {
    await runMigration(migration);
  }

  console.log('\n' + '='.repeat(80));
  console.log('🎉 Migration process completed!');
  console.log('='.repeat(80));
  
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

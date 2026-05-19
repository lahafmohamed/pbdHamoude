import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  console.log('🔌 Connexion à PostgreSQL...');

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'magasin_db',
  });

  try {
    const migrationPath = path.join(__dirname, 'src', 'db', '002_mouvements_stock.sql');
    const migration = fs.readFileSync(migrationPath, 'utf-8');

    await pool.query(migration);
    console.log('✅ Migration appliquée avec succès');
    console.log('📋 Table mouvements_stock créée');

    // Verify
    const { rows } = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'mouvements_stock' ORDER BY ordinal_position"
    );
    console.log('\n📊 Colonnes:');
    rows.forEach(r => console.log(`   - ${r.column_name}: ${r.data_type}`));

    await pool.end();
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

runMigration();

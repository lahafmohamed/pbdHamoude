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
    const migrationPath = path.join(__dirname, 'src', 'db', '003_fournisseurs.sql');
    const migration = fs.readFileSync(migrationPath, 'utf-8');

    await pool.query(migration);
    console.log('✅ Migration appliquée avec succès');
    console.log('📋 Tables créées:');
    console.log('   - fournisseurs');
    console.log('   - commandes_fournisseur');
    console.log('   - commande_lignes');
    console.log('   - produits.fournisseur_id (colonne ajoutée)');

    // Verify tables
    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'fourn%' OR table_name LIKE 'commande%' ORDER BY table_name"
    );
    console.log('\n📊 Tables:');
    rows.forEach(r => console.log(`   - ${r.table_name}`));

    await pool.end();
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

runMigration();

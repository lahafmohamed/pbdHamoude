const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

async function fix() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('1. Ajouter magasin_id à acomptes_fournisseur...');
    await client.query('ALTER TABLE acomptes_fournisseur ADD COLUMN IF NOT EXISTS magasin_id INTEGER REFERENCES magasins(id) ON DELETE SET NULL');
    console.log('   ✅ OK');

    console.log('2. Ajouter session_caisse_id à acomptes_fournisseur...');
    await client.query('ALTER TABLE acomptes_fournisseur ADD COLUMN IF NOT EXISTS session_caisse_id INTEGER REFERENCES sessions_caisse(id) ON DELETE SET NULL');
    console.log('   ✅ OK');

    await client.query('COMMIT');
    console.log('\n🎉 Colonnes ajoutées !');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ ERREUR:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}
fix();

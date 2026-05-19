const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('1. Renommer date_fermeture en date_cloture...');
    await client.query(`ALTER TABLE sessions_caisse RENAME COLUMN date_fermeture TO date_cloture`);
    console.log('   ✅ Colonne renommée.');

    // Supprimer et recréer les index qui pourraient pointer sur l'ancien nom
    console.log('2. Met à jour les index liés à date_fermeture...');
    await client.query(`DROP INDEX IF EXISTS idx_sessions_caisse_date_fermeture`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_date_cloture ON sessions_caisse(date_cloture)`);
    console.log('   ✅ Index mis à jour.');

    await client.query('COMMIT');
    console.log('\n🎉 Colonne date_cloture créée avec succès !');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ ERREUR:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

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

    console.log('1. Renommer session_id en session_caisse_id dans mouvements_caisse...');
    await client.query(`
      ALTER TABLE mouvements_caisse 
      RENAME COLUMN session_id TO session_caisse_id
    `);
    console.log('   ✅ Colonne renommée.');

    console.log('2. Supprimer et recréer les index...');
    await client.query(`DROP INDEX IF EXISTS idx_mouvements_caisse_session`);
    await client.query(`DROP INDEX IF EXISTS idx_mouvements_session`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mouvements_session_caisse ON mouvements_caisse(session_caisse_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mouvements_session_date ON mouvements_caisse(session_caisse_id, date_mouvement)`);
    console.log('   ✅ Index recréés.');

    console.log('3. Mettre à jour la contrainte de clé étrangère...');
    const fkRes = await client.query(`
      SELECT conname FROM pg_constraint 
      WHERE conrelid = 'mouvements_caisse'::regclass 
      AND contype = 'f' 
      AND pg_get_constraintdef(oid) LIKE '%session_id%'
    `);
    for (const row of fkRes.rows) {
      console.log(`   Suppression FK ${row.conname}...`);
      await client.query(`ALTER TABLE mouvements_caisse DROP CONSTRAINT IF EXISTS ${row.conname}`);
    }
    await client.query(`
      ALTER TABLE mouvements_caisse 
      ADD CONSTRAINT fk_mouvements_caisse_session 
      FOREIGN KEY (session_caisse_id) REFERENCES sessions_caisse(id) ON DELETE CASCADE
    `);
    console.log('   ✅ Clé étrangère recréée.');

    await client.query('COMMIT');
    console.log('\n🎉 Migration terminée avec succès !');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ ERREUR:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

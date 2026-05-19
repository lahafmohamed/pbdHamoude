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

    console.log('1. Rendre type_mouvement nullable...');
    await client.query('ALTER TABLE mouvements_caisse ALTER COLUMN type_mouvement DROP NOT NULL');
    console.log('   ✅ OK');

    console.log('2. Rendre methode_paiement nullable...');
    await client.query('ALTER TABLE mouvements_caisse ALTER COLUMN methode_paiement DROP NOT NULL');
    console.log('   ✅ OK');

    console.log('3. Copier anciennes valeurs type_mouvement vers type...');
    await client.query(`
      UPDATE mouvements_caisse
      SET type = CASE
        WHEN type_mouvement IN ('vente', 'entree_autre') THEN 'encaissement'
        WHEN type_mouvement IN ('remise', 'sortie') THEN 'decaissement'
        ELSE 'encaissement'
      END,
      categorie = CASE
        WHEN type_mouvement = 'vente' THEN 'paiement_client'
        WHEN type_mouvement = 'remise' THEN 'remboursement_client'
        WHEN type_mouvement = 'sortie' THEN 'autre_sortie'
        WHEN type_mouvement = 'entree_autre' THEN 'autre_entree'
        ELSE 'autre_entree'
      END,
      libelle = COALESCE(description, 'Mouvement #' || id)
      WHERE type IS NULL
    `);
    console.log('   ✅ OK');

    await client.query('COMMIT');
    console.log('\n🎉 Fix terminé !');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ ERREUR:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}
fix();

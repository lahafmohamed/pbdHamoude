const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

async function test() {
  try {
    console.log('Test 1: Vérifier la structure de sessions_caisse');
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'sessions_caisse' ORDER BY ordinal_position
    `);
    console.table(cols.rows);

    console.log('\nTest 2: Vérifier les données sessions_caisse');
    const data = await pool.query('SELECT id, magasin_id, statut, ouverte_par_user_id, fond_initial FROM sessions_caisse');
    console.table(data.rows);

    console.log('\nTest 3: Exécuter la requête exacte du backend (magasin_id=1)');
    const query = `
      SELECT s.*, 
             m.nom as magasin_nom, m.code as magasin_code,
             ouv.username as ouvert_par_username,
             fer.username as cloture_par_username
       FROM sessions_caisse s
       JOIN magasins m ON s.magasin_id = m.id
       LEFT JOIN utilisateurs ouv ON s.ouverte_par_user_id = ouv.id
       LEFT JOIN utilisateurs fer ON s.cloturee_par_user_id = fer.id
       WHERE s.magasin_id = $1 AND s.statut = 'ouverte'
       LIMIT 1
    `;
    const res = await pool.query(query, [1]);
    console.log('Résultat:', res.rows);

    console.log('\nTest 4: Vérifier si la contrainte CHECK pose problème');
    const check = await pool.query(`SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'sessions_caisse'::regclass`);
    console.table(check.rows);

    await pool.end();
  } catch (err) {
    console.error('❌ ERREUR:', err.message);
    console.error(err.stack);
    await pool.end();
    process.exit(1);
  }
}
test();

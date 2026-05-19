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
    await client.query('ALTER TABLE sessions_caisse DROP CONSTRAINT IF EXISTS sessions_caisse_statut_check');
    console.log('Constraint dropped');
    await client.query("UPDATE sessions_caisse SET statut = 'cloturee' WHERE statut = 'fermee'");
    console.log('Data updated');
    await client.query("ALTER TABLE sessions_caisse ADD CONSTRAINT sessions_caisse_statut_check CHECK (statut IN ('ouverte', 'cloturee'))");
    console.log('Constraint added');
    await client.query('COMMIT');
    console.log('Fixed!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}
fix();

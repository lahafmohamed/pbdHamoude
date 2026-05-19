import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'magasin_db',
});

// Expand the role constraint to include all roles used by the app
await pool.query(`
  ALTER TABLE utilisateurs
    DROP CONSTRAINT IF EXISTS utilisateurs_role_check
`);
await pool.query(`
  ALTER TABLE utilisateurs
    ADD CONSTRAINT utilisateurs_role_check
    CHECK (role IN ('admin', 'manager', 'caissier', 'depot_staff', 'magasin_staff', 'viewer'))
`);
console.log('Constraint updated.');

const username = 'lahafDepot';
const password = 'depot123';
const nomComplet = 'Lahaf Depot Manager';
const role = 'depot_staff';

const passwordHash = await bcrypt.hash(password, 10);

const { rows } = await pool.query(
  `INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif)
   VALUES ($1, $2, $3, $4, $5, $6)
   ON CONFLICT (username) DO UPDATE SET password_hash = $3, role = $5, nom_complet = $4, actif = $6
   RETURNING id, username, role, nom_complet`,
  [username, `${username}@magasin.local`, passwordHash, nomComplet, role, true]
);

console.log('User created/updated:', rows[0]);
await pool.end();

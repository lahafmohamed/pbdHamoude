#!/usr/bin/env node
/**
 * reset-users.mjs
 * Wipe utilisateurs + user_sessions, seed 3 fresh users (admin/manager/caissier).
 */

import pg from 'pg';
import bcrypt from 'bcrypt';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

const USERS = [
  { username: 'admin',    password: 'admin123',    role: 'admin',    nom_complet: 'Administrateur Système', email: 'admin@magasin.local' },
  { username: 'manager',  password: 'manager123',  role: 'manager',  nom_complet: 'Manager Magasin',         email: 'manager@magasin.local' },
  { username: 'caissier', password: 'caissier123', role: 'caissier', nom_complet: 'Caissier Magasin',        email: 'caissier@magasin.local' },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Wipe sessions first (depends on user_id FK)
    console.log('Wiping user_sessions + sessions...');
    await client.query('TRUNCATE TABLE user_sessions, sessions RESTART IDENTITY CASCADE');

    console.log('Wiping utilisateurs (CASCADE → utilisateur_locations, user_location_roles, employes refs SET NULL)...');
    // Some FKs use SET NULL not CASCADE — DELETE handles both safely
    await client.query('DELETE FROM utilisateurs');
    await client.query("SELECT setval('utilisateurs_id_seq', 1, false)");

    console.log('\nSeeding 3 users...');
    for (const u of USERS) {
      const hash = await bcrypt.hash(u.password, 10);
      await client.query(
        `INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif, must_change_password)
         VALUES ($1,$2,$3,$4,$5,TRUE,FALSE)`,
        [u.username, u.email, hash, u.nom_complet, u.role]
      );
      console.log(`  ✓ ${u.username.padEnd(10)} / ${u.password.padEnd(12)} (${u.role})`);
    }

    await client.query('COMMIT');

    const { rows } = await client.query('SELECT id, username, role, actif FROM utilisateurs ORDER BY id');
    console.log('\n=== Users in DB ===');
    console.table(rows);
    console.log('\n✅ Done. Login at frontend with creds above.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();

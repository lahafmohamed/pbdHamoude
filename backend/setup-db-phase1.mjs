// Complete database setup for Phase 1
// Run with: node setup-db-phase1.mjs
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

async function setup() {
  const client = await pool.connect();

  try {
    console.log('🔧 Setting up Phase 1 database...\n');

    await client.query('BEGIN');

    // 1. Enable stock movement trigger
    console.log('📦 Enabling stock movement trigger...');
    try {
      await client.query(`
        DROP TRIGGER IF EXISTS log_produits_stock ON produits;
        CREATE TRIGGER log_produits_stock
          AFTER UPDATE ON produits
          FOR EACH ROW
          EXECUTE FUNCTION log_mouvement_stock();
      `);
      console.log('✅ Stock movement trigger enabled\n');
    } catch (e) {
      console.log('⚠️  Trigger may already exist or products table not ready\n');
    }

    // 2. Auth tables
    console.log('📦 Creating auth tables...');
    const authSql = fs.readFileSync(path.join(__dirname, 'src', 'db', '004_auth.sql'), 'utf8');
    await client.query(authSql);
    console.log('✅ Auth tables created\n');

    // 3. Soft deletes
    console.log('📦 Adding soft delete columns...');
    const softDeleteSql = fs.readFileSync(path.join(__dirname, 'src', 'db', '005_soft_deletes.sql'), 'utf8');
    await client.query(softDeleteSql);
    console.log('✅ Soft delete columns added\n');

    // 4. Sequences
    console.log('📦 Creating sequences for invoice/order numbering...');
    const sequencesSql = fs.readFileSync(path.join(__dirname, 'src', 'db', '006_sequences.sql'), 'utf8');
    await client.query(sequencesSql);
    console.log('✅ Sequences created\n');

    // 5. Phase 3 Retail Operations (user_sessions table for auth)
    console.log('📦 Applying Phase 3 retail operations (user_sessions table)...');
    const phase3Sql = fs.readFileSync(path.join(__dirname, 'src', 'db', '013_phase3_retail.sql'), 'utf8');
    await client.query(phase3Sql);
    console.log('✅ Phase 3 retail operations applied\n');

    // 6. Update default user passwords with fresh hashes
    console.log('🔑 Setting up default users...');
    const BCRYPT_ROUNDS = 10;
    const adminHash = await bcrypt.hash('admin123', BCRYPT_ROUNDS);
    const managerHash = await bcrypt.hash('manager123', BCRYPT_ROUNDS);
    const caissierHash = await bcrypt.hash('caissier123', BCRYPT_ROUNDS);

    await client.query(
      `INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (username) DO UPDATE SET password_hash = $3`,
      ['admin', 'admin@magasin.local', adminHash, 'Administrateur Systeme', 'admin', true]
    );
    await client.query(
      `INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (username) DO UPDATE SET password_hash = $3`,
      ['manager', 'manager@magasin.local', managerHash, 'Manager Magasin', 'manager', true]
    );
    await client.query(
      `INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (username) DO UPDATE SET password_hash = $3`,
      ['caissier', 'caissier@magasin.local', caissierHash, 'Caissier Magasin', 'caissier', true]
    );
    console.log('✅ Default users created\n');

    await client.query('COMMIT');

    console.log('🎉 Phase 1 setup complete!\n');
    console.log('═══════════════════════════════════════');
    console.log('Default Login Credentials:');
    console.log('  admin    / admin123    (full access)');
    console.log('  manager  / manager123  (management)');
    console.log('  caissier / caissier123 (cashier)');
    console.log('═══════════════════════════════════════');
    console.log('⚠️  CHANGE THESE PASSWORDS AFTER FIRST LOGIN!\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Setup failed:', error.message);
    if (error.detail) console.error('Detail:', error.detail);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

setup();

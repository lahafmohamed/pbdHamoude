// Setup script for Phase 4 - ERP Modules
// Run with: node setup-erp-modules.mjs
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

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
    console.log('🔧 Setting up Phase 4 - ERP Modules...\n');

    await client.query('BEGIN');

    // Read and execute ERP modules SQL file
    console.log('📦 Creating ERP module tables...');
    const erpModulesSql = fs.readFileSync(path.join(__dirname, 'src', 'db', '019_erp_modules.sql'), 'utf8');
    await client.query(erpModulesSql);
    console.log('✅ ERP module tables created\n');

    await client.query('COMMIT');

    console.log('🎉 Phase 4 ERP modules setup complete!\n');
    console.log('═══════════════════════════════════════');
    console.log('New Modules Available:');
    console.log('  ✓ Multi-Location/Multi-Warehouse');
    console.log('  ✓ Supplier Invoice Management');
    console.log('  ✓ General Ledger / Accounting');
    console.log('  ✓ Employee Management & Commission');
    console.log('  ✓ 3-Way Purchase Order Matching');
    console.log('═══════════════════════════════════════');
    console.log('API Endpoints:');
    console.log('  /api/stock-locations');
    console.log('  /api/stock-transfers');
    console.log('  /api/factures-fournisseur');
    console.log('  /api/general-ledger');
    console.log('  /api/employes');
    console.log('  /api/three-way-matches\n');

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

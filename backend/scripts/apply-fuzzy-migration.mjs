#!/usr/bin/env node
/**
 * Script d'application de la migration fuzzy search
 * Active l'extension pg_trgm et crée les index pour la recherche approximative
 */

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

async function run() {
  const client = await pool.connect();
  try {
    const migrationPath = path.join(__dirname, '..', 'migrations', '002_fuzzy_search.sql');
    
    if (!fs.existsSync(migrationPath)) {
      console.error(`❌ Migration file not found: ${migrationPath}`);
      process.exit(1);
    }
    
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    console.log('▶️  Applying fuzzy search migration...');
    console.log('   - Activating pg_trgm extension');
    console.log('   - Creating trigram indexes on produits table');
    
    await client.query(sql);
    
    console.log('✅ Fuzzy search migration applied successfully!');
    console.log('\n📝 Features enabled:');
    console.log('   - Similarity search with pg_trgm');
    console.log('   - Fuzzy matching for typos');
    console.log('   - Autocomplete suggestions');
    console.log('\n🔍 Test it: Search for "hp desk" will now find "HP Desktop"');
    
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

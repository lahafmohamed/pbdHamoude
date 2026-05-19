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

const migrations = [
  '030_unified_numbering.sql',
  '031_soft_delete_devis_bl.sql',
  '032_unify_document_lignes.sql',
  '033_avoir_apply_to_facture.sql',
  '034_backward_links.sql',
  '035_soft_delete_avoir.sql',
];

async function run() {
  const client = await pool.connect();
  try {
    for (const file of migrations) {
      const filePath = path.join(__dirname, 'src', 'db', file);
      if (!fs.existsSync(filePath)) {
        console.log(`⚠️  Skipping missing file: ${file}`);
        continue;
      }
      const sql = fs.readFileSync(filePath, 'utf-8');
      console.log(`▶️  Running ${file}...`);
      await client.query(sql);
      console.log(`✅ ${file} done`);
    }
    console.log('\n🎉 All migrations completed');
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

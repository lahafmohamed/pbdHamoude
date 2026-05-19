const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '5432'), user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'magasin_db' });
pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'acomptes_fournisseur' AND column_name IN ('magasin_id','session_caisse_id')`).then(r => { console.log('acomptes_fournisseur cols:', r.rows); return pool.end(); }).catch(e => { console.error(e); pool.end(); });

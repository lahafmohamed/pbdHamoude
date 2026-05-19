#!/usr/bin/env node
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

const sql = `
  ALTER TABLE acomptes_clients
    DROP CONSTRAINT IF EXISTS acomptes_clients_methode_paiement_check;
  ALTER TABLE acomptes_clients
    ADD CONSTRAINT acomptes_clients_methode_paiement_check
    CHECK (methode_paiement IN (
      'espece','carte','cheque','virement',
      'mobile_money','orange_money','mtn_money','wave',
      'compensation'
    ));

  ALTER TABLE acomptes_fournisseur
    DROP CONSTRAINT IF EXISTS acomptes_fournisseur_methode_paiement_check;
  ALTER TABLE acomptes_fournisseur
    ADD CONSTRAINT acomptes_fournisseur_methode_paiement_check
    CHECK (methode_paiement IN (
      'espece','carte','cheque','virement',
      'mobile_money','orange_money','mtn_money','wave',
      'compensation'
    ));
`;

const client = await pool.connect();
try {
  await client.query(sql);
  console.log('✅ Migration 054 applied: compensation method allowed in acomptes');
} catch (err) {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}

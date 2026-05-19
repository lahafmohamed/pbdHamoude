import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

async function fixInvoiceRemainingDue() {
  const client = await pool.connect();
  try {
    const { rowCount, rows } = await client.query(`
      UPDATE factures
      SET remaining_due = GREATEST(COALESCE(total, 0) - COALESCE(montant_paye, 0), 0)
      WHERE deleted_at IS NULL
        AND statut != 'annulee'
        AND COALESCE(remaining_due, 0) = 0
        AND GREATEST(COALESCE(total, 0) - COALESCE(montant_paye, 0), 0) > 0
      RETURNING id, numero_facture, remaining_due
    `);

    console.log(`updated_count=${rowCount}`);
    if (rows.length > 0) {
      console.log('updated_invoices=', rows.map((r) => r.numero_facture).join(', '));
    }
  } finally {
    client.release();
    await pool.end();
  }
}

fixInvoiceRemainingDue().catch((error) => {
  console.error('Fix failed:', error.message);
  process.exitCode = 1;
});

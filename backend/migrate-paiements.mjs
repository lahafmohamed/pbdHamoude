import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('🚀 Starting payments migration...');

    await client.query('BEGIN');

    // 1. Create paiements table
    console.log('📦 Creating paiements table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS paiements (
        id SERIAL PRIMARY KEY,
        facture_id INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
        montant NUMERIC(10, 2) NOT NULL,
        methode_paiement VARCHAR(50) NOT NULL CHECK (methode_paiement IN ('espece', 'carte', 'cheque', 'virement')),
        date_paiement TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reference VARCHAR(100),
        notes TEXT,
        cree_par INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Create indexes for performance
    console.log('📊 Creating indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_paiements_facture ON paiements(facture_id);
      CREATE INDEX IF NOT EXISTS idx_paiements_date ON paiements(date_paiement);
      CREATE INDEX IF NOT EXISTS idx_paiements_methode ON paiements(methode_paiement);
    `);

    // 3. Add remaining_due column to factures
    console.log('🔧 Adding remaining_due column to factures...');
    await client.query(`
      ALTER TABLE factures 
      ADD COLUMN IF NOT EXISTS remaining_due NUMERIC(10, 2);
    `);

    // 4. Backfill remaining_due for existing invoices
    console.log('📝 Backfilling remaining_due for existing invoices...');
    await client.query(`
      UPDATE factures 
      SET remaining_due = total - COALESCE(
        (SELECT SUM(montant) FROM paiements WHERE facture_id = factures.id),
        0
      );
    `);

    // 5. Update statut CHECK constraint to include 'partielle'
    console.log('🔄 Updating facture statut constraint...');
    await client.query(`
      ALTER TABLE factures DROP CONSTRAINT IF EXISTS factures_statut_check;
      ALTER TABLE factures ADD CONSTRAINT factures_statut_check 
        CHECK (statut IN ('payee', 'partielle', 'en_attente', 'annulee'));
    `);

    // 6. Create function to auto-update invoice status
    console.log('🎯 Creating auto-update function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION update_facture_payment_status()
      RETURNS TRIGGER AS $$
      DECLARE
        total_due NUMERIC(10, 2);
        total_paid NUMERIC(10, 2);
      BEGIN
        -- Get invoice total
        SELECT total INTO total_due FROM factures WHERE id = NEW.facture_id;
        
        -- Calculate total payments
        SELECT COALESCE(SUM(montant), 0) INTO total_paid 
        FROM paiements 
        WHERE facture_id = NEW.facture_id;
        
        -- Update invoice status and remaining_due
        UPDATE factures 
        SET 
          remaining_due = total_due - total_paid,
          statut = CASE
            WHEN total_paid = 0 THEN 'en_attente'
            WHEN total_paid < total_due THEN 'partielle'
            WHEN total_paid >= total_due THEN 'payee'
          END
        WHERE id = NEW.facture_id;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 7. Create trigger for payment insert
    console.log('⚡ Creating payment insert trigger...');
    await client.query(`
      DROP TRIGGER IF EXISTS trg_after_payment_insert ON paiements;
      CREATE TRIGGER trg_after_payment_insert
        AFTER INSERT ON paiements
        FOR EACH ROW
        EXECUTE FUNCTION update_facture_payment_status();
    `);

    // 8. Create trigger for payment delete
    console.log('⚡ Creating payment delete trigger...');
    await client.query(`
      CREATE OR REPLACE FUNCTION update_facture_on_payment_delete()
      RETURNS TRIGGER AS $$
      DECLARE
        total_due NUMERIC(10, 2);
        total_paid NUMERIC(10, 2);
      BEGIN
        -- Get invoice total
        SELECT total INTO total_due FROM factures WHERE id = OLD.facture_id;
        
        -- Calculate total payments (excluding deleted one)
        SELECT COALESCE(SUM(montant), 0) INTO total_paid 
        FROM paiements 
        WHERE facture_id = OLD.facture_id AND id != OLD.id;
        
        -- Update invoice status and remaining_due
        UPDATE factures 
        SET 
          remaining_due = total_due - total_paid,
          statut = CASE
            WHEN total_paid = 0 THEN 'en_attente'
            WHEN total_paid < total_due THEN 'partielle'
            WHEN total_paid >= total_due THEN 'payee'
          END
        WHERE id = OLD.facture_id;
        
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_after_payment_delete ON paiements;
      CREATE TRIGGER trg_after_payment_delete
        AFTER DELETE ON paiements
        FOR EACH ROW
        EXECUTE FUNCTION update_facture_on_payment_delete();
    `);

    await client.query('COMMIT');

    console.log('✅ Migration completed successfully!');
    console.log('📊 Migration summary:');
    console.log('   - Created paiements table');
    console.log('   - Added indexes for performance');
    console.log('   - Added remaining_due column to factures');
    console.log('   - Updated statut constraint to include "partielle"');
    console.log('   - Created auto-update triggers');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

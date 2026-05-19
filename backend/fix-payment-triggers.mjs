import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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

async function fixTriggers() {
  const client = await pool.connect();

  try {
    console.log('🔧 Fixing payment triggers...');

    await client.query('BEGIN');

    // Drop existing trigger and function
    await client.query(`DROP TRIGGER IF EXISTS trg_after_payment_insert ON paiements;`);
    await client.query(`DROP TRIGGER IF EXISTS trg_after_payment_delete ON paiements;`);
    await client.query(`DROP FUNCTION IF EXISTS update_facture_payment_status();`);
    await client.query(`DROP FUNCTION IF EXISTS update_facture_on_payment_delete();`);

    // Add columns if they don't exist
    console.log('📦 Adding montant_paye and remaining_due columns...');
    await client.query(`
      ALTER TABLE factures 
      ADD COLUMN IF NOT EXISTS montant_paye NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
    `);
    await client.query(`
      ALTER TABLE factures 
      ADD COLUMN IF NOT EXISTS remaining_due NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
    `);
    console.log('✅ Columns added successfully');

    // Recreate the trigger function for INSERT
    console.log('📦 Creating update function for INSERT...');
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
        
        -- Update invoice status, montant_paye and remaining_due
        UPDATE factures 
        SET 
          montant_paye = total_paid,
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

    // Recreate the trigger for INSERT
    console.log('⚡ Creating trigger for INSERT...');
    await client.query(`
      CREATE TRIGGER trg_after_payment_insert
        AFTER INSERT ON paiements
        FOR EACH ROW
        EXECUTE FUNCTION update_facture_payment_status();
    `);

    // Recreate the trigger function for DELETE
    console.log('📦 Creating update function for DELETE...');
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
        WHERE facture_id = OLD.facture_id;
        
        -- Update invoice status, montant_paye and remaining_due
        UPDATE factures 
        SET 
          montant_paye = total_paid,
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
    `);

    // Recreate the trigger for DELETE
    console.log('⚡ Creating trigger for DELETE...');
    await client.query(`
      CREATE TRIGGER trg_after_payment_delete
        AFTER DELETE ON paiements
        FOR EACH ROW
        EXECUTE FUNCTION update_facture_on_payment_delete();
    `);

    // Now fix all existing invoices
    console.log('🔄 Fixing all existing invoices...');
    await client.query(`
      UPDATE factures f
      SET 
        montant_paye = COALESCE((
          SELECT SUM(p.montant) 
          FROM paiements p 
          WHERE p.facture_id = f.id
        ), 0),
        remaining_due = f.total - COALESCE((
          SELECT SUM(p.montant) 
          FROM paiements p 
          WHERE p.facture_id = f.id
        ), 0),
        statut = CASE
          WHEN COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.facture_id = f.id), 0) = 0 THEN 'en_attente'
          WHEN COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.facture_id = f.id), 0) < f.total THEN 'partielle'
          WHEN COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.facture_id = f.id), 0) >= f.total THEN 'payee'
          ELSE 'en_attente'
        END
      WHERE statut != 'annulee';
    `);

    await client.query('COMMIT');

    console.log('✅ Triggers and invoices fixed successfully!');

    // Verify the fix
    const { rows: verification } = await pool.query(`
      SELECT f.id, f.numero_facture, f.total, f.montant_paye, f.remaining_due, f.statut,
             (SELECT COUNT(*) FROM paiements p WHERE p.facture_id = f.id) as payment_count,
             (SELECT COALESCE(SUM(p.montant), 0) FROM paiements p WHERE p.facture_id = f.id) as actual_payments
      FROM factures f
      WHERE f.statut != 'annulee'
      ORDER BY f.id DESC
      LIMIT 5
    `);

    console.log('\n📊 Verification (last 5 invoices):');
    verification.forEach(inv => {
      console.log(`  ${inv.numero_facture}:`);
      console.log(`    Total: ${inv.total}`);
      console.log(`    montant_paye (DB): ${inv.montant_paye}`);
      console.log(`    actual_payments: ${inv.actual_payments}`);
      console.log(`    remaining_due (DB): ${inv.remaining_due}`);
      console.log(`    statut: ${inv.statut}`);
      console.log(`    Match: ${inv.montant_paye == inv.actual_payments ? '✅' : '❌'}`);
      console.log('');
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Fix failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

fixTriggers();

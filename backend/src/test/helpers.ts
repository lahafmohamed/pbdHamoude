import pool from '../db/connection';

/**
 * Test database helper utilities
 * Provides isolated test transactions and cleanup
 */

export class TestDB {
  /**
   * Run a test within a transaction that gets rolled back at the end
   * This ensures test isolation - no data persists between tests
   */
  static async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn();
      await client.query('ROLLBACK');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create a test client and return its ID
   */
  static async createTestClient(
    overrides: Partial<{
      nom: string;
      prenom: string;
      email: string;
      telephone: string;
      credit_max: number;
      solde_actuel: number;
      delai_paiement: string;
    }> = {}
  ): Promise<number> {
    const { rows } = await pool.query(
      `INSERT INTO clients (nom, prenom, email, telephone, adresse, nif, credit_max, solde_actuel, delai_paiement)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        overrides.nom || 'Test Client',
        overrides.prenom || 'Test',
        overrides.email || `test-${Date.now()}@example.com`,
        overrides.telephone || '00000000',
        'Test Address',
        null,
        overrides.credit_max ?? 0,
        overrides.solde_actuel ?? 0,
        overrides.delai_paiement || 'immediat',
      ]
    );
    return rows[0].id;
  }

  /**
   * Check whether a column exists in a table
   */
  static async hasColumn(tableName: string, columnName: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [tableName, columnName]
    );

    return rows.length > 0;
  }

  /**
   * Create a test product and return its ID
   */
  static async createTestProduct(overrides: Partial<{ reference: string; nom: string; prix_vente: number; stock: number }> = {}): Promise<number> {
    const timestamp = Date.now();
    const randomSuffix = Math.floor(Math.random() * 1000000);
    const reference = overrides.reference
      ? `${overrides.reference}-${timestamp}-${randomSuffix}`
      : `TEST-REF-${timestamp}-${randomSuffix}`;

    const { rows } = await pool.query(
      `INSERT INTO produits (reference, nom, description, categorie, prix_achat, prix_vente, stock, stock_min)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        reference,
        overrides.nom || 'Test Product',
        'Test description',
        'Test Category',
        1000,
        overrides.prix_vente || 5000,
        overrides.stock ?? 100,
        5,
      ]
    );
    return rows[0].id;
  }

  /**
   * Soft-delete all test clients (cleanup)
   */
  static async cleanupClients(): Promise<void> {
    await pool.query("UPDATE clients SET deleted_at = CURRENT_TIMESTAMP WHERE nom LIKE 'Test Client%' AND deleted_at IS NULL");
  }

  /**
   * Soft-delete all test products (cleanup)
   */
  static async cleanupProducts(): Promise<void> {
    await pool.query("UPDATE produits SET deleted_at = CURRENT_TIMESTAMP WHERE reference LIKE 'TEST-REF%' AND deleted_at IS NULL");
  }

  /**
   * Delete all test invoices and related data
   */
  static async cleanupInvoices(): Promise<void> {
    // Delete payments for test invoices
    await pool.query(`DELETE FROM paiements WHERE facture_id IN (SELECT id FROM factures WHERE numero_facture LIKE 'TEST-FAC%')`);
    // Delete invoice lines for test invoices
    await pool.query(`DELETE FROM document_lignes WHERE document_type = 'facture' AND document_id IN (SELECT id FROM factures WHERE numero_facture LIKE 'TEST-FAC%')`);
    // Delete test invoices
    await pool.query("DELETE FROM factures WHERE numero_facture LIKE 'TEST-FAC%'");
  }
}

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { FactureService, CreateFactureInput } from '../services/FactureService';
import pool from '../db/connection';
import { TestDB } from '../test/helpers';

const factureService = new FactureService();

// Test data storage
let testClientId: number;
let creditLimitedClientId: number;
let testProduct1Id: number;
let testProduct2Id: number;
let createdInvoiceIds: number[] = [];
const testRunId = Date.now();

describe('FactureService', () => {
  // ---- Setup & Teardown ----

  beforeAll(async () => {
    // Create test client
    testClientId = await TestDB.createTestClient({ nom: 'FactureTest Client' });

    // Create credit-limited client for policy tests
    creditLimitedClientId = await TestDB.createTestClient({
      nom: 'FactureCredit Client',
      credit_max: 1000,
      solde_actuel: 900,
      delai_paiement: 'net_30',
    });

    // Create test products
    testProduct1Id = await TestDB.createTestProduct({
      reference: `TEST-PROD-001-${testRunId}`,
      nom: 'Test Product 1',
      prix_vente: 5000,
      stock: 500,
    });

    testProduct2Id = await TestDB.createTestProduct({
      reference: `TEST-PROD-002-${testRunId}`,
      nom: 'Test Product 2',
      prix_vente: 10000,
      stock: 30,
    });
  });

  afterAll(async () => {
    // Cleanup: soft-delete test invoices, products, and client
    await TestDB.cleanupInvoices();
    await TestDB.cleanupProducts();
    await TestDB.cleanupClients();
  });

  // ---- CREATE() TESTS ----

  describe('create()', () => {
    it('should successfully create an invoice with valid data', async () => {
      const input: CreateFactureInput = {
        tiers_id: testClientId,
        lignes: [
          { produit_id: testProduct1Id, quantite: 2, prix_unitaire: 5000 },
        ],
        notes: 'Test invoice',
      };

      const result = await factureService.create(input);
      createdInvoiceIds.push(result.id);

      expect(result.id).toBeDefined();
      expect(result.numero_facture).toMatch(/^FAC-\d{4}-\d{5}$/);
      expect(result.total).toBeGreaterThan(0);

      // Verify invoice was created with correct totals
      const fetched = await factureService.getById(result.id);
      expect(fetched).not.toBeNull();
      expect(fetched.tiers_id).toBe(testClientId);
      expect(fetched.lignes).toHaveLength(1);
      expect(fetched.lignes[0].produit_id).toBe(testProduct1Id);
      expect(fetched.lignes[0].quantite).toBe(2);
      expect(fetched.statut).toBe('en_attente');

      // Verify TVA calculation (19%)
      const sousTotal = 2 * 5000; // 10000
      const expectedTva = sousTotal * 0.19; // 1900
      const expectedTotal = sousTotal + expectedTva; // 11900
      expect(parseFloat(fetched.sous_total)).toBe(sousTotal);
      expect(parseFloat(fetched.tva)).toBe(expectedTva);
      expect(parseFloat(fetched.total)).toBe(expectedTotal);
    });

    it('should create an invoice with multiple lines', async () => {
      const input: CreateFactureInput = {
        tiers_id: testClientId,
        lignes: [
          { produit_id: testProduct1Id, quantite: 1, prix_unitaire: 5000 },
          { produit_id: testProduct2Id, quantite: 2, prix_unitaire: 10000 },
        ],
      };

      const result = await factureService.create(input);
      createdInvoiceIds.push(result.id);

      expect(result.id).toBeDefined();

      const fetched = await factureService.getById(result.id);
      expect(fetched.lignes).toHaveLength(2);

      // Verify totals: (1*5000) + (2*10000) = 25000
      const sousTotal = 5000 + 20000;
      const expectedTotal = sousTotal + sousTotal * 0.19;
      expect(parseFloat(fetched.total)).toBe(expectedTotal);
    });

    it('should throw error when no lines provided', async () => {
      const input: CreateFactureInput = {
        tiers_id: testClientId,
        lignes: [],
      };

      await expect(factureService.create(input)).rejects.toThrow(
        'La facture doit contenir au moins un produit'
      );
    });

    it('should throw error when product not found', async () => {
      const input: CreateFactureInput = {
        tiers_id: testClientId,
        lignes: [
          { produit_id: 999999, quantite: 1, prix_unitaire: 5000 },
        ],
      };

      await expect(factureService.create(input)).rejects.toThrow(
        'Produit ID 999999 non trouvé'
      );
    });

    it('should throw error when stock is insufficient', async () => {
      // Create a product with very low stock
      const lowStockProductId = await TestDB.createTestProduct({
        reference: 'TEST-LOW-STOCK',
        nom: 'Low Stock Product',
        stock: 2,
      });

      const input: CreateFactureInput = {
        tiers_id: testClientId,
        lignes: [
          { produit_id: lowStockProductId, quantite: 10, prix_unitaire: 5000 },
        ],
      };

      await expect(factureService.create(input)).rejects.toThrow(
        /Stock insuffisant/
      );
    });

    it('should deduct stock when invoice is created', async () => {
      // Create product with known stock
      const productId = await TestDB.createTestProduct({
        reference: 'TEST-STOCK-DEDUCT',
        nom: 'Stock Deduct Test',
        stock: 100,
      });

      const input: CreateFactureInput = {
        tiers_id: testClientId,
        lignes: [
          { produit_id: productId, quantite: 5, prix_unitaire: 3000 },
        ],
      };

      const result = await factureService.create(input);
      createdInvoiceIds.push(result.id);

      // Verify stock was deducted
      const { rows } = await pool.query('SELECT stock FROM produits WHERE id = $1', [productId]);
      expect(rows[0].stock).toBe(95); // 100 - 5
    });

    it('should rollback transaction on insufficient stock mid-invoice', async () => {
      // Create two products: one with enough stock, one without
      const goodProductId = await TestDB.createTestProduct({
        reference: 'TEST-ROLLBACK-GOOD',
        stock: 50,
      });

      const lowStockProductId = await TestDB.createTestProduct({
        reference: 'TEST-ROLLBACK-LOW',
        stock: 1,
      });

      const input: CreateFactureInput = {
        tiers_id: testClientId,
        lignes: [
          { produit_id: goodProductId, quantite: 5, prix_unitaire: 5000 },
          { produit_id: lowStockProductId, quantite: 10, prix_unitaire: 3000 }, // Will fail
        ],
      };

      await expect(factureService.create(input)).rejects.toThrow(/Stock insuffisant/);

      // Verify stock was NOT deducted (transaction rolled back)
      const { rows } = await pool.query('SELECT stock FROM produits WHERE id = $1', [goodProductId]);
      expect(rows[0].stock).toBe(50); // Should be unchanged
    });

    it('should generate sequential invoice numbers', async () => {
      const input1: CreateFactureInput = {
        tiers_id: testClientId,
        lignes: [{ produit_id: testProduct1Id, quantite: 1, prix_unitaire: 5000 }],
      };

      const input2: CreateFactureInput = {
        tiers_id: testClientId,
        lignes: [{ produit_id: testProduct1Id, quantite: 1, prix_unitaire: 5000 }],
      };

      const result1 = await factureService.create(input1);
      createdInvoiceIds.push(result1.id);

      const result2 = await factureService.create(input2);
      createdInvoiceIds.push(result2.id);

      // Extract sequence numbers
      const seq1 = parseInt(result1.numero_facture.split('-')[2]);
      const seq2 = parseInt(result2.numero_facture.split('-')[2]);
      expect(seq2).toBe(seq1 + 1);
    });

    it('should create invoice with notes', async () => {
      const input: CreateFactureInput = {
        tiers_id: testClientId,
        lignes: [{ produit_id: testProduct1Id, quantite: 1, prix_unitaire: 5000 }],
        notes: 'Important test invoice',
      };

      const result = await factureService.create(input);
      createdInvoiceIds.push(result.id);

      const fetched = await factureService.getById(result.id);
      expect(fetched.notes).toBe('Important test invoice');
    });

    it('should handle zero-priced items', async () => {
      const input: CreateFactureInput = {
        tiers_id: testClientId,
        lignes: [{ produit_id: testProduct1Id, quantite: 1, prix_unitaire: 0 }],
      };

      const result = await factureService.create(input);
      createdInvoiceIds.push(result.id);

      expect(result.total).toBe(0); // 0 + 0*0.19 = 0
    });

    it('should reject invoice when credit limit would be exceeded', async () => {
      const input: CreateFactureInput = {
        tiers_id: creditLimitedClientId,
        lignes: [{ produit_id: testProduct1Id, quantite: 1, prix_unitaire: 5000 }],
      };

      await expect(factureService.create(input)).rejects.toThrow(/Plafond de crédit dépassé/);
    });

    it('should auto-calculate date_echeance from client delai_paiement when column exists', async () => {
      const hasDateEcheance = await TestDB.hasColumn('factures', 'date_echeance');

      if (!hasDateEcheance) {
        return;
      }

      const input: CreateFactureInput = {
        tiers_id: testClientId,
        lignes: [{ produit_id: testProduct1Id, quantite: 1, prix_unitaire: 5000 }],
      };

      await pool.query(
        `UPDATE clients
         SET delai_paiement = 'net_60'
         WHERE id = $1`,
        [testClientId]
      );

      const result = await factureService.create(input);
      createdInvoiceIds.push(result.id);

      const { rows } = await pool.query(
        `SELECT date_echeance, delai_paiement
         FROM factures
         WHERE id = $1`,
        [result.id]
      );

      expect(rows[0].delai_paiement).toBe('net_60');

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const actual = new Date(rows[0].date_echeance);
      actual.setHours(0, 0, 0, 0);

      const diffDays = Math.round((actual.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(60);
    });
  });

  // ---- getAll() TESTS ----

  describe('getAll()', () => {
    beforeAll(async () => {
      // Create some test invoices for listing tests
      for (let i = 0; i < 5; i++) {
        const result = await factureService.create({
          tiers_id: testClientId,
          lignes: [{ produit_id: testProduct1Id, quantite: 1, prix_unitaire: 5000 }],
        });
        createdInvoiceIds.push(result.id);
      }
    });

    it('should return paginated results', async () => {
      const result = await factureService.getAll(undefined, undefined, 1, 3);

      expect(result.data).toBeDefined();
      expect(result.data.length).toBeLessThanOrEqual(3);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(3);
      expect(result.pagination.total).toBeGreaterThanOrEqual(5);
    });

    it('should apply search filter', async () => {
      const result = await factureService.getAll('FAC-', undefined, 1, 20);
      expect(result.data.length).toBeGreaterThanOrEqual(5);
    });

    it('should return empty results for non-matching search', async () => {
      const result = await factureService.getAll('NONEXISTENT-XYZ', undefined, 1, 20);
      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should apply status filter', async () => {
      const result = await factureService.getAll(undefined, 'en_attente', 1, 20);
      expect(result.data.length).toBeGreaterThanOrEqual(5);

      // All should be en_attente
      result.data.forEach((f: any) => {
        expect(f.statut).toBe('en_attente');
      });
    });

    it('should sort by specified column', async () => {
      const result = await factureService.getAll(undefined, undefined, 1, 20, 'numero_facture', 'ASC');
      expect(result.data.length).toBeGreaterThan(0);

      // Verify ascending order
      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i].numero_facture >= result.data[i - 1].numero_facture).toBe(true);
      }
    });
  });

  // ---- getById() TESTS ----

  describe('getById()', () => {
    it('should return invoice with lines and payments', async () => {
      // Create an invoice
      const result = await factureService.create({
        tiers_id: testClientId,
        lignes: [
          { produit_id: testProduct1Id, quantite: 2, prix_unitaire: 5000 },
          { produit_id: testProduct2Id, quantite: 1, prix_unitaire: 10000 },
        ],
      });
      createdInvoiceIds.push(result.id);

      const fetched = await factureService.getById(result.id);

      expect(fetched).not.toBeNull();
      expect(fetched.id).toBe(result.id);
      expect(fetched.lignes).toHaveLength(2);
      expect(fetched.paiements).toBeDefined();
      expect(fetched.client_nom).toBe('FactureTest Client');
    });

    it('should return null for non-existent invoice', async () => {
      const result = await factureService.getById(999999);
      expect(result).toBeNull();
    });

    it('should return null for soft-deleted invoice', async () => {
      const result = await factureService.create({
        tiers_id: testClientId,
        lignes: [{ produit_id: testProduct1Id, quantite: 1, prix_unitaire: 5000 }],
      });
      createdInvoiceIds.push(result.id);

      await factureService.delete(result.id);

      const fetched = await factureService.getById(result.id);
      expect(fetched).toBeNull();
    });
  });

  // ---- updateStatut() TESTS ----

  describe('updateStatut()', () => {
    it('should update invoice status', async () => {
      const result = await factureService.create({
        tiers_id: testClientId,
        lignes: [{ produit_id: testProduct1Id, quantite: 1, prix_unitaire: 5000 }],
      });
      createdInvoiceIds.push(result.id);

      const updated = await factureService.updateStatut(result.id, 'payee');
      expect(updated).toBe(true);

      const fetched = await factureService.getById(result.id);
      expect(fetched.statut).toBe('payee');
    });

    it('should return false for non-existent invoice', async () => {
      const updated = await factureService.updateStatut(999999, 'payee');
      expect(updated).toBe(false);
    });

    it('should return false for soft-deleted invoice', async () => {
      const result = await factureService.create({
        tiers_id: testClientId,
        lignes: [{ produit_id: testProduct1Id, quantite: 1, prix_unitaire: 5000 }],
      });
      createdInvoiceIds.push(result.id);

      await factureService.delete(result.id);

      const updated = await factureService.updateStatut(result.id, 'payee');
      expect(updated).toBe(false);
    });
  });

  // ---- delete() TESTS ----

  describe('delete()', () => {
    it('should soft-delete an invoice', async () => {
      const result = await factureService.create({
        tiers_id: testClientId,
        lignes: [{ produit_id: testProduct1Id, quantite: 1, prix_unitaire: 5000 }],
      });
      createdInvoiceIds.push(result.id);

      const deleted = await factureService.delete(result.id);
      expect(deleted).toBe(true);

      const fetched = await factureService.getById(result.id);
      expect(fetched).toBeNull();
    });

    it('should return false for non-existent invoice', async () => {
      const deleted = await factureService.delete(999999);
      expect(deleted).toBe(false);
    });

    it('should restore stock when restaurerStock is true', async () => {
      const productId = await TestDB.createTestProduct({
        reference: 'TEST-RESTORE',
        stock: 50,
      });

      const result = await factureService.create({
        tiers_id: testClientId,
        lignes: [{ produit_id: productId, quantite: 10, prix_unitaire: 5000 }],
      });
      createdInvoiceIds.push(result.id);

      // Stock should be 40
      const { rows: beforeRows } = await pool.query('SELECT stock FROM produits WHERE id = $1', [productId]);
      expect(beforeRows[0].stock).toBe(40);

      // Delete with stock restoration
      const deleted = await factureService.delete(result.id, true);
      expect(deleted).toBe(true);

      // Stock should be back to 50
      const { rows: afterRows } = await pool.query('SELECT stock FROM produits WHERE id = $1', [productId]);
      expect(afterRows[0].stock).toBe(50);
    });

    it('should NOT restore stock when restaurerStock is false', async () => {
      const productId = await TestDB.createTestProduct({
        reference: 'TEST-NO-RESTORE',
        stock: 50,
      });

      const result = await factureService.create({
        tiers_id: testClientId,
        lignes: [{ produit_id: productId, quantite: 10, prix_unitaire: 5000 }],
      });
      createdInvoiceIds.push(result.id);

      const deleted = await factureService.delete(result.id, false);
      expect(deleted).toBe(true);

      // Stock should remain at 40
      const { rows } = await pool.query('SELECT stock FROM produits WHERE id = $1', [productId]);
      expect(rows[0].stock).toBe(40);
    });
  });

  // ---- getStats() TESTS ----

  describe('getStats()', () => {
    it('should return dashboard stats', async () => {
      const stats = await factureService.getStats();

      expect(stats.total_factures).toBeDefined();
      expect(stats.total_factures.count).toBeDefined();
      expect(stats.total_factures.montant).toBeDefined();
      expect(stats.factures_mois).toBeDefined();
    });
  });

  // ---- getRevenueTrends() TESTS ----

  describe('getRevenueTrends()', () => {
    it('should return revenue trend data', async () => {
      const trends = await factureService.getRevenueTrends(30);

      expect(Array.isArray(trends)).toBe(true);
      if (trends.length > 0) {
        expect(trends[0]).toHaveProperty('date');
        expect(trends[0]).toHaveProperty('count');
        expect(trends[0]).toHaveProperty('total');
      }
    });

    it('should accept custom days parameter', async () => {
      const trends7 = await factureService.getRevenueTrends(7);
      const trends30 = await factureService.getRevenueTrends(30);

      // 30-day range should have >= data points than 7-day range
      expect(trends30.length).toBeGreaterThanOrEqual(trends7.length);
    });
  });

  // ---- getTopProducts() TESTS ----

  describe('getTopProducts()', () => {
    it('should return top selling products', async () => {
      const topProducts = await factureService.getTopProducts(5);

      expect(Array.isArray(topProducts)).toBe(true);
      if (topProducts.length > 0) {
        expect(topProducts[0]).toHaveProperty('nom');
        expect(topProducts[0]).toHaveProperty('total_quantite');
        expect(topProducts[0]).toHaveProperty('total_ventes');
      }
    });

    it('should respect limit parameter', async () => {
      const top3 = await factureService.getTopProducts(3);
      const top10 = await factureService.getTopProducts(10);

      expect(top3.length).toBeLessThanOrEqual(3);
      expect(top10.length).toBeLessThanOrEqual(10);
      expect(top10.length).toBeGreaterThanOrEqual(top3.length);
    });
  });

  // ---- getTopClients() TESTS ----

  describe('getTopClients()', () => {
    it('should return top clients by spending', async () => {
      const topClients = await factureService.getTopClients(5);

      expect(Array.isArray(topClients)).toBe(true);
      if (topClients.length > 0) {
        expect(topClients[0]).toHaveProperty('nom');
        expect(topClients[0]).toHaveProperty('total_depenses');
        expect(topClients[0]).toHaveProperty('nombre_factures');
      }
    });

    it('should exclude cancelled invoices', async () => {
      // Create and cancel an invoice
      const result = await factureService.create({
        tiers_id: testClientId,
        lignes: [{ produit_id: testProduct1Id, quantite: 100, prix_unitaire: 5000 }],
      });
      createdInvoiceIds.push(result.id);

      await factureService.updateStatut(result.id, 'annulee');

      const topClients = await factureService.getTopClients(5);
      // Should not include the cancelled invoice in totals
      const clientEntry = topClients.find((c: any) => c.nom === 'FactureTest Client');
      if (clientEntry) {
        expect(parseFloat(clientEntry.total_depenses)).toBeLessThan(100 * 5000 * 1.19);
      }
    });
  });
});

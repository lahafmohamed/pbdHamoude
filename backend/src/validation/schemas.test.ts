import { describe, it, expect } from 'vitest';
import {
  createFactureSchema,
  factureLigneSchema,
  updateFactureStatutSchema,
  createProduitSchema,
  updateProduitSchema,
  createClientSchema,
  updateClientSchema,
  createPaiementSchema,
  adjustStockSchema,
  stockMovementSchema,
} from '../validation/schemas';

// ============================================
// Facture Validation Tests
// ============================================

describe('Zod Validation Schemas', () => {
  describe('factureLigneSchema', () => {
    it('should validate valid line item', () => {
      const result = factureLigneSchema.safeParse({
        produit_id: 1,
        quantite: 5,
        prix_unitaire: 5000,
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing produit_id', () => {
      const result = factureLigneSchema.safeParse({
        quantite: 5,
        prix_unitaire: 5000,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative quantity', () => {
      const result = factureLigneSchema.safeParse({
        produit_id: 1,
        quantite: -5,
        prix_unitaire: 5000,
      });
      expect(result.success).toBe(false);
    });

    it('should reject zero quantity', () => {
      const result = factureLigneSchema.safeParse({
        produit_id: 1,
        quantite: 0,
        prix_unitaire: 5000,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative price', () => {
      const result = factureLigneSchema.safeParse({
        produit_id: 1,
        quantite: 5,
        prix_unitaire: -1000,
      });
      expect(result.success).toBe(false);
    });

    it('should accept zero price', () => {
      const result = factureLigneSchema.safeParse({
        produit_id: 1,
        quantite: 1,
        prix_unitaire: 0,
      });
      expect(result.success).toBe(true);
    });

    it('should coerce string numbers to integers', () => {
      const result = factureLigneSchema.safeParse({
        produit_id: '1',
        quantite: '5',
        prix_unitaire: '5000',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('createFactureSchema', () => {
    it('should validate valid invoice', () => {
      const result = createFactureSchema.safeParse({
        client_id: 1,
        lignes: [
          { produit_id: 1, quantite: 2, prix_unitaire: 5000 },
          { produit_id: 2, quantite: 1, prix_unitaire: 10000 },
        ],
        notes: 'Test notes',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing client_id', () => {
      const result = createFactureSchema.safeParse({
        lignes: [{ produit_id: 1, quantite: 1, prix_unitaire: 5000 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty lines array', () => {
      const result = createFactureSchema.safeParse({
        client_id: 1,
        lignes: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative client_id', () => {
      const result = createFactureSchema.safeParse({
        client_id: -1,
        lignes: [{ produit_id: 1, quantite: 1, prix_unitaire: 5000 }],
      });
      expect(result.success).toBe(false);
    });

    it('should accept invoice without notes', () => {
      const result = createFactureSchema.safeParse({
        client_id: 1,
        lignes: [{ produit_id: 1, quantite: 1, prix_unitaire: 5000 }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('updateFactureStatutSchema', () => {
    it('should accept valid status: payee', () => {
      const result = updateFactureStatutSchema.safeParse({ statut: 'payee' });
      expect(result.success).toBe(true);
    });

    it('should accept valid status: en_attente', () => {
      const result = updateFactureStatutSchema.safeParse({ statut: 'en_attente' });
      expect(result.success).toBe(true);
    });

    it('should accept valid status: partielle', () => {
      const result = updateFactureStatutSchema.safeParse({ statut: 'partielle' });
      expect(result.success).toBe(true);
    });

    it('should accept valid status: annulee', () => {
      const result = updateFactureStatutSchema.safeParse({ statut: 'annulee' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const result = updateFactureStatutSchema.safeParse({ statut: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should reject missing statut', () => {
      const result = updateFactureStatutSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  // ============================================
  // Produit Validation Tests
  // ============================================

  describe('createProduitSchema', () => {
    it('should validate valid product', () => {
      const result = createProduitSchema.safeParse({
        reference: 'PROD-001',
        nom: 'Test Product',
        description: 'A test product',
        categorie: 'Electronics',
        prix_achat: 1000,
        prix_vente: 2000,
        stock: 50,
        stock_min: 5,
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty reference', () => {
      const result = createProduitSchema.safeParse({
        reference: '',
        nom: 'Test Product',
        prix_achat: 1000,
        prix_vente: 2000,
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const result = createProduitSchema.safeParse({
        reference: 'PROD-001',
        nom: '',
        prix_achat: 1000,
        prix_vente: 2000,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative purchase price', () => {
      const result = createProduitSchema.safeParse({
        reference: 'PROD-001',
        nom: 'Test Product',
        prix_achat: -100,
        prix_vente: 2000,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative sale price', () => {
      const result = createProduitSchema.safeParse({
        reference: 'PROD-001',
        nom: 'Test Product',
        prix_achat: 1000,
        prix_vente: -2000,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative stock', () => {
      const result = createProduitSchema.safeParse({
        reference: 'PROD-001',
        nom: 'Test Product',
        prix_achat: 1000,
        prix_vente: 2000,
        stock: -5,
      });
      expect(result.success).toBe(false);
    });

    it('should default stock to 0 and stock_min to 5', () => {
      const result = createProduitSchema.safeParse({
        reference: 'PROD-001',
        nom: 'Test Product',
        prix_achat: 1000,
        prix_vente: 2000,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.stock).toBe(0);
        expect(result.data.stock_min).toBe(5);
      }
    });

    it('should coerce string numbers', () => {
      const result = createProduitSchema.safeParse({
        reference: 'PROD-001',
        nom: 'Test Product',
        prix_achat: '1000',
        prix_vente: '2000',
        stock: '50',
      });
      expect(result.success).toBe(true);
    });

    it('should validate one-shot create with location and initial stock', () => {
      const result = createProduitSchema.safeParse({
        reference: 'PROD-DEPOT-001',
        nom: 'Produit Depot',
        prix_achat: 1000,
        prix_vente: 2000,
        location_id: 1,
        initial_stock: 25,
      });
      expect(result.success).toBe(true);
    });

    it('should reject location without initial stock', () => {
      const result = createProduitSchema.safeParse({
        reference: 'PROD-DEPOT-002',
        nom: 'Produit Depot Invalide',
        prix_achat: 1000,
        prix_vente: 2000,
        location_id: 1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateProduitSchema', () => {
    it('should validate partial update', () => {
      const result = updateProduitSchema.safeParse({
        nom: 'Updated Name',
      });
      expect(result.success).toBe(true);
    });

    it('should validate multiple field update', () => {
      const result = updateProduitSchema.safeParse({
        nom: 'Updated Name',
        prix_vente: 3000,
        stock: 25,
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty object (all fields optional)', () => {
      const result = updateProduitSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('adjustStockSchema', () => {
    it('should accept positive adjustment', () => {
      const result = adjustStockSchema.safeParse({ quantite: 10 });
      expect(result.success).toBe(true);
    });

    it('should accept negative adjustment', () => {
      const result = adjustStockSchema.safeParse({ quantite: -5 });
      expect(result.success).toBe(true);
    });

    it('should reject zero adjustment', () => {
      const result = adjustStockSchema.safeParse({ quantite: 0 });
      expect(result.success).toBe(false);
    });

    it('should coerce string numbers', () => {
      const result = adjustStockSchema.safeParse({ quantite: '10' });
      expect(result.success).toBe(true);
    });

    it('should accept location-aware adjustment', () => {
      const result = adjustStockSchema.safeParse({ quantite: 10, location_id: 2 });
      expect(result.success).toBe(true);
    });
  });

  describe('stockMovementSchema', () => {
    it('should validate valid movement', () => {
      const result = stockMovementSchema.safeParse({
        type_mouvement: 'vente',
        quantite: -5,
        raison: 'Sale to customer',
        reference_liee: 'FAC-2024-00001',
      });
      expect(result.success).toBe(true);
    });

    it('should accept all movement types', () => {
      const types = ['vente', 'ajustement', 'retour', 'commande', 'perte', 'autre'];
      types.forEach((type) => {
        const result = stockMovementSchema.safeParse({
          type_mouvement: type,
          quantite: 10,
        });
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid movement type', () => {
      const result = stockMovementSchema.safeParse({
        type_mouvement: 'invalid_type',
        quantite: 10,
      });
      expect(result.success).toBe(false);
    });

    it('should reject zero quantity', () => {
      const result = stockMovementSchema.safeParse({
        type_mouvement: 'vente',
        quantite: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  // ============================================
  // Client Validation Tests
  // ============================================

  describe('createClientSchema', () => {
    it('should validate valid client', () => {
      const result = createClientSchema.safeParse({
        nom: 'Dupont',
        prenom: 'Jean',
        email: 'jean@example.com',
        telephone: '0612345678',
        adresse: '123 Test St',
        nif: '123456789',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const result = createClientSchema.safeParse({ nom: '' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid email', () => {
      const result = createClientSchema.safeParse({
        nom: 'Test',
        email: 'not-an-email',
      });
      expect(result.success).toBe(false);
    });

    it('should accept minimal client (name only)', () => {
      const result = createClientSchema.safeParse({ nom: 'Minimal' });
      expect(result.success).toBe(true);
    });
  });

  describe('updateClientSchema', () => {
    it('should accept partial update', () => {
      const result = updateClientSchema.safeParse({ telephone: '0699999999' });
      expect(result.success).toBe(true);
    });

    it('should accept empty object', () => {
      const result = updateClientSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  // ============================================
  // Paiement Validation Tests
  // ============================================

  describe('createPaiementSchema', () => {
    it('should validate valid payment', () => {
      const result = createPaiementSchema.safeParse({
        facture_id: 1,
        montant: 50000,
        methode_paiement: 'espece',
        reference: 'PAY-001',
        notes: 'Cash payment',
      });
      expect(result.success).toBe(true);
    });

    it('should accept all payment methods', () => {
      const methods = ['espece', 'carte', 'cheque', 'virement'];
      methods.forEach((method) => {
        const result = createPaiementSchema.safeParse({
          facture_id: 1,
          montant: 10000,
          methode_paiement: method,
        });
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid payment method', () => {
      const result = createPaiementSchema.safeParse({
        facture_id: 1,
        montant: 10000,
        methode_paiement: 'crypto',
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative amount', () => {
      const result = createPaiementSchema.safeParse({
        facture_id: 1,
        montant: -5000,
        methode_paiement: 'espece',
      });
      expect(result.success).toBe(false);
    });

    it('should reject zero amount', () => {
      const result = createPaiementSchema.safeParse({
        facture_id: 1,
        montant: 0,
        methode_paiement: 'espece',
      });
      expect(result.success).toBe(false);
    });

    it('should accept payment without optional fields', () => {
      const result = createPaiementSchema.safeParse({
        facture_id: 1,
        montant: 10000,
        methode_paiement: 'espece',
      });
      expect(result.success).toBe(true);
    });
  });
});

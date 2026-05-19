import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server';

// Store created resource IDs for cleanup
let createdFactureIds: number[] = [];
let createdClientId: number;
let createdProduitIds: number[] = [];
let authToken: string;

// Helper to get auth token
async function getAuthToken(): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({
    username: 'admin',
    password: 'admin123',
  });
  return res.body.data.token;
}

// Helper to create a test client via API
async function createTestClient(): Promise<number> {
  const res = await request(app)
    .post('/api/clients')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      nom: 'API Test Client',
      prenom: 'Test',
      email: `apitest-${Date.now()}@example.com`,
      telephone: '00000000',
    });
  return res.body.data.id;
}

// Helper to create a test product via API
async function createTestProduct(stock: number = 100): Promise<number> {
  const res = await request(app)
    .post('/api/produits')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      reference: `API-TEST-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      nom: 'API Test Product',
      description: 'Test product',
      categorie: 'Test',
      prix_achat: 1000,
      prix_vente: 5000,
      stock,
      stock_min: 5,
    });
  return res.body.data.id;
}

describe('Factures API (Integration)', () => {
  beforeAll(async () => {
    authToken = await getAuthToken();
    createdClientId = await createTestClient();
  });

  afterAll(async () => {
    // Cleanup: delete created invoices
    for (const id of createdFactureIds) {
      await request(app)
        .delete(`/api/factures/${id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ restaurer_stock: true });
    }
    // Cleanup: delete created products
    for (const id of createdProduitIds) {
      await request(app)
        .delete(`/api/produits/${id}`)
        .set('Authorization', `Bearer ${authToken}`);
    }
    // Cleanup: delete created client
    await request(app)
      .delete(`/api/clients/${createdClientId}`)
      .set('Authorization', `Bearer ${authToken}`);
  });

  // ---- POST /api/factures ----

  describe('POST /api/factures', () => {
    it('should create a new invoice', async () => {
      const produitId = await createTestProduct(50);
      createdProduitIds.push(produitId);

      const res = await request(app)
        .post('/api/factures')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client_id: createdClientId,
          lignes: [
            { produit_id: produitId, quantite: 2, prix_unitaire: 5000 },
          ],
          notes: 'API test invoice',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.numero_facture).toMatch(/^FAC-\d{4}-\d{5}$/);
      expect(res.body.message).toBe('Facture créée et stock mis à jour');

      createdFactureIds.push(res.body.data.id);
    });

    it('should reject creating invoice without auth token', async () => {
      const res = await request(app)
        .post('/api/factures')
        .send({
          client_id: createdClientId,
          lignes: [{ produit_id: 1, quantite: 1, prix_unitaire: 5000 }],
        });

      expect(res.status).toBe(401);
    });

    it('should reject invoice with empty lines', async () => {
      const res = await request(app)
        .post('/api/factures')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client_id: createdClientId,
          lignes: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invoice with insufficient stock', async () => {
      const produitId = await createTestProduct(1);
      createdProduitIds.push(produitId);

      const res = await request(app)
        .post('/api/factures')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client_id: createdClientId,
          lignes: [
            { produit_id: produitId, quantite: 100, prix_unitaire: 5000 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Stock insuffisant/);
    });

    it('should reject invoice with invalid client_id', async () => {
      const produitId = await createTestProduct(50);
      createdProduitIds.push(produitId);

      const res = await request(app)
        .post('/api/factures')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client_id: 999999,
          lignes: [
            { produit_id: produitId, quantite: 1, prix_unitaire: 5000 },
          ],
        });

      // Will fail due to foreign key constraint
      expect(res.status).toBe(400);
    });
  });

  // ---- GET /api/factures ----

  describe('GET /api/factures', () => {
    beforeAll(async () => {
      // Create a few invoices for testing
      for (let i = 0; i < 3; i++) {
        const produitId = await createTestProduct(50);
        createdProduitIds.push(produitId);

        const res = await request(app)
          .post('/api/factures')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            client_id: createdClientId,
            lignes: [{ produit_id: produitId, quantite: 1, prix_unitaire: 5000 }],
          });
        createdFactureIds.push(res.body.data.id);
      }
    });

    it('should return paginated invoices', async () => {
      const res = await request(app)
        .get('/api/factures')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(5);
    });

    it('should search by invoice number', async () => {
      const res = await request(app)
        .get('/api/factures')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ search: 'FAC-' });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by status', async () => {
      const res = await request(app)
        .get('/api/factures')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ statut: 'en_attente' });

      expect(res.status).toBe(200);
      res.body.data.forEach((f: any) => {
        expect(f.statut).toBe('en_attente');
      });
    });

    it('should return empty result for non-matching search', async () => {
      const res = await request(app)
        .get('/api/factures')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ search: 'NONEXISTENT-XYZ' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.pagination.total).toBe(0);
    });
  });

  // ---- GET /api/factures/:id ----

  describe('GET /api/factures/:id', () => {
    let testFactureId: number;

    beforeAll(async () => {
      const produitId = await createTestProduct(50);
      createdProduitIds.push(produitId);

      const res = await request(app)
        .post('/api/factures')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client_id: createdClientId,
          lignes: [{ produit_id: produitId, quantite: 1, prix_unitaire: 5000 }],
        });
      testFactureId = res.body.data.id;
      createdFactureIds.push(testFactureId);
    });

    it('should return invoice by ID with lines', async () => {
      const res = await request(app)
        .get(`/api/factures/${testFactureId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(testFactureId);
      expect(res.body.data.lignes).toBeDefined();
      expect(Array.isArray(res.body.data.lignes)).toBe(true);
    });

    it('should return 404 for non-existent invoice', async () => {
      const res = await request(app)
        .get('/api/factures/999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ---- PUT /api/factures/:id/statut ----

  describe('PUT /api/factures/:id/statut', () => {
    let testFactureId: number;

    beforeAll(async () => {
      const produitId = await createTestProduct(50);
      createdProduitIds.push(produitId);

      const res = await request(app)
        .post('/api/factures')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client_id: createdClientId,
          lignes: [{ produit_id: produitId, quantite: 1, prix_unitaire: 5000 }],
        });
      testFactureId = res.body.data.id;
      createdFactureIds.push(testFactureId);
    });

    it('should update invoice status', async () => {
      const res = await request(app)
        .put(`/api/factures/${testFactureId}/statut`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ statut: 'payee' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Statut mis à jour');
    });

    it('should reject invalid status', async () => {
      const res = await request(app)
        .put(`/api/factures/${testFactureId}/statut`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ statut: 'invalid_status' });

      // Zod validation should reject this
      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent invoice', async () => {
      const res = await request(app)
        .put('/api/factures/999999/statut')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ statut: 'payee' });

      expect(res.status).toBe(404);
    });
  });

  // ---- DELETE /api/factures/:id ----

  describe('DELETE /api/factures/:id', () => {
    it('should soft-delete an invoice', async () => {
      const produitId = await createTestProduct(50);
      createdProduitIds.push(produitId);

      const createRes = await request(app)
        .post('/api/factures')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          client_id: createdClientId,
          lignes: [{ produit_id: produitId, quantite: 1, prix_unitaire: 5000 }],
        });
      const factureId = createRes.body.data.id;

      const res = await request(app)
        .delete(`/api/factures/${factureId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ restaurer_stock: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 for non-existent invoice', async () => {
      const res = await request(app)
        .delete('/api/factures/999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ---- GET /api/factures/stats ----

  describe('GET /api/factures/stats', () => {
    it('should return dashboard stats', async () => {
      const res = await request(app)
        .get('/api/factures/stats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('total_factures');
      expect(res.body.data).toHaveProperty('factures_mois');
      expect(res.body.data).toHaveProperty('alertes_stock');
    });
  });

  // ---- GET /api/factures/revenue-trends ----

  describe('GET /api/factures/revenue-trends', () => {
    it('should return revenue trend data', async () => {
      const res = await request(app)
        .get('/api/factures/revenue-trends')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ days: 30 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ---- GET /api/factures/top-products ----

  describe('GET /api/factures/top-products', () => {
    it('should return top products', async () => {
      const res = await request(app)
        .get('/api/factures/top-products')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ limit: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ---- GET /api/factures/top-clients ----

  describe('GET /api/factures/top-clients', () => {
    it('should return top clients', async () => {
      const res = await request(app)
        .get('/api/factures/top-clients')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ limit: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});

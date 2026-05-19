import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server';

let authToken: string;
let createdProduitIds: number[] = [];

async function getAuthToken(): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({
    username: 'admin',
    password: 'admin123',
  });
  return res.body.data.token;
}

describe('Produits API (Integration)', () => {
  beforeAll(async () => {
    authToken = await getAuthToken();
  });

  afterAll(async () => {
    // Cleanup
    for (const id of createdProduitIds) {
      await request(app)
        .delete(`/api/produits/${id}`)
        .set('Authorization', `Bearer ${authToken}`);
    }
  });

  // ---- POST /api/produits ----

  describe('POST /api/produits', () => {
    it('should create a new product', async () => {
      const res = await request(app)
        .post('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reference: `PROD-${Date.now()}`,
          nom: 'Test Laptop HP',
          description: 'Laptop HP 15 pouces',
          categorie: 'Laptops',
          prix_achat: 200000,
          prix_vente: 250000,
          stock: 50,
          stock_min: 10,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.reference).toBe(`PROD-${Date.now()}`);
      expect(res.body.data.nom).toBe('Test Laptop HP');
      expect(res.body.data.stock).toBe(50);

      createdProduitIds.push(res.body.data.id);
    });

    it('should reject creating product without auth', async () => {
      const res = await request(app)
        .post('/api/produits')
        .send({
          reference: 'PROD-NOAUTH',
          nom: 'Unauthorized Product',
          prix_achat: 1000,
          prix_vente: 2000,
        });

      expect(res.status).toBe(401);
    });

    it('should reject product with missing required fields', async () => {
      const res = await request(app)
        .post('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reference: '', // Empty reference
          nom: '', // Empty name
          prix_achat: -100, // Negative price
          prix_vente: -200,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject product with negative prices', async () => {
      const res = await request(app)
        .post('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reference: `PROD-${Date.now()}-NEG`,
          nom: 'Negative Price Product',
          prix_achat: -100,
          prix_vente: -200,
        });

      expect(res.status).toBe(400);
    });

    it('should create product with minimal fields', async () => {
      const res = await request(app)
        .post('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reference: `PROD-MIN-${Date.now()}`,
          nom: 'Minimal Product',
          prix_achat: 500,
          prix_vente: 1000,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.stock).toBe(0); // default
      expect(res.body.data.stock_min).toBe(5); // default

      createdProduitIds.push(res.body.data.id);
    });
  });

  // ---- GET /api/produits ----

  describe('GET /api/produits', () => {
    beforeAll(async () => {
      // Create test products
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/produits')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            reference: `PROD-LIST-${Date.now()}-${i}`,
            nom: `List Test Product ${i}`,
            categorie: i < 3 ? 'Laptops' : 'Accessoires',
            prix_achat: 1000,
            prix_vente: 2000,
            stock: i < 2 ? 2 : 50, // Some low stock
            stock_min: 5,
          });
        createdProduitIds.push(res.body.data.id);
      }
    });

    it('should return paginated products', async () => {
      const res = await request(app)
        .get('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 3 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.pagination).toBeDefined();
      expect(res.body.data.length).toBeLessThanOrEqual(3);
    });

    it('should search products by name', async () => {
      const res = await request(app)
        .get('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ search: 'List Test' });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(5);
    });

    it('should filter products by category', async () => {
      const res = await request(app)
        .get('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ categorie: 'Laptops' });

      expect(res.status).toBe(200);
      res.body.data.forEach((p: any) => {
        expect(p.categorie).toBe('Laptops');
      });
    });

    it('should filter low stock products', async () => {
      const res = await request(app)
        .get('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ low_stock: 'true' });

      expect(res.status).toBe(200);
      res.body.data.forEach((p: any) => {
        expect(p.stock).toBeLessThanOrEqual(p.stock_min);
      });
    });

    it('should return empty result for non-matching search', async () => {
      const res = await request(app)
        .get('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ search: 'NONEXISTENT-PRODUCT-XYZ' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ---- GET /api/produits/:id ----

  describe('GET /api/produits/:id', () => {
    let testProductId: number;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reference: `PROD-GET-${Date.now()}`,
          nom: 'Get By ID Test Product',
          prix_achat: 1000,
          prix_vente: 2000,
          stock: 25,
        });
      testProductId = res.body.data.id;
      createdProduitIds.push(testProductId);
    });

    it('should return product by ID', async () => {
      const res = await request(app)
        .get(`/api/produits/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(testProductId);
      expect(res.body.data.nom).toBe('Get By ID Test Product');
      expect(res.body.data.stock).toBe(25);
    });

    it('should return 404 for non-existent product', async () => {
      const res = await request(app)
        .get('/api/produits/999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ---- PUT /api/produits/:id ----

  describe('PUT /api/produits/:id', () => {
    let testProductId: number;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reference: `PROD-UPDATE-${Date.now()}`,
          nom: 'Update Test Product',
          prix_achat: 1000,
          prix_vente: 2000,
          stock: 30,
        });
      testProductId = res.body.data.id;
      createdProduitIds.push(testProductId);
    });

    it('should update product fields', async () => {
      const res = await request(app)
        .put(`/api/produits/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nom: 'Updated Product Name',
          prix_vente: 3000,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.nom).toBe('Updated Product Name');
      expect(parseFloat(res.body.data.prix_vente)).toBe(3000);
    });

    it('should reject update with no fields', async () => {
      const res = await request(app)
        .put(`/api/produits/${testProductId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Aucun champ à mettre à jour');
    });

    it('should return 404 for non-existent product', async () => {
      const res = await request(app)
        .put('/api/produits/999999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ nom: 'New Name' });

      expect(res.status).toBe(404);
    });
  });

  // ---- PATCH /api/produits/:id/stock ----

  describe('PATCH /api/produits/:id/stock', () => {
    let testProductId: number;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reference: `PROD-STOCK-${Date.now()}`,
          nom: 'Stock Test Product',
          prix_achat: 1000,
          prix_vente: 2000,
          stock: 50,
        });
      testProductId = res.body.data.id;
      createdProduitIds.push(testProductId);
    });

    it('should adjust stock positively', async () => {
      const res = await request(app)
        .patch(`/api/produits/${testProductId}/stock`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ quantite: 20 });

      expect(res.status).toBe(200);
      expect(res.body.data.stock).toBe(70); // 50 + 20
    });

    it('should adjust stock negatively', async () => {
      const res = await request(app)
        .patch(`/api/produits/${testProductId}/stock`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ quantite: -10 });

      expect(res.status).toBe(200);
      expect(res.body.data.stock).toBe(60); // 70 - 10
    });

    it('should return 404 for non-existent product', async () => {
      const res = await request(app)
        .patch('/api/produits/999999/stock')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ quantite: 10 });

      expect(res.status).toBe(404);
    });
  });

  // ---- DELETE /api/produits/:id ----

  describe('DELETE /api/produits/:id', () => {
    it('should soft-delete a product', async () => {
      const createRes = await request(app)
        .post('/api/produits')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reference: `PROD-DELETE-${Date.now()}`,
          nom: 'Delete Test Product',
          prix_achat: 1000,
          prix_vente: 2000,
        });
      const produitId = createRes.body.data.id;

      const res = await request(app)
        .delete(`/api/produits/${produitId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 for non-existent product', async () => {
      const res = await request(app)
        .delete('/api/produits/999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ---- GET /api/produits/stock-valuation ----

  describe('GET /api/produits/stock-valuation', () => {
    it('should return stock valuation summary', async () => {
      const res = await request(app)
        .get('/api/produits/stock-valuation')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('total_produits');
      expect(res.body.data).toHaveProperty('total_unites');
      expect(res.body.data).toHaveProperty('valeur_achat');
      expect(res.body.data).toHaveProperty('valeur_vente');
    });
  });

  // ---- GET /api/produits/stock-by-category ----

  describe('GET /api/produits/stock-by-category', () => {
    it('should return stock by category', async () => {
      const res = await request(app)
        .get('/api/produits/stock-by-category')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});

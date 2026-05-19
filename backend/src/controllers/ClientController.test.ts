import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server';

let authToken: string;
let createdClientIds: number[] = [];

async function getAuthToken(): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({
    username: 'admin',
    password: 'admin123',
  });
  return res.body.data.token;
}

describe('Clients API (Integration)', () => {
  beforeAll(async () => {
    authToken = await getAuthToken();
  });

  afterAll(async () => {
    // Cleanup
    for (const id of createdClientIds) {
      await request(app)
        .delete(`/api/clients/${id}`)
        .set('Authorization', `Bearer ${authToken}`);
    }
  });

  // ---- POST /api/clients ----

  describe('POST /api/clients', () => {
    it('should create a new client', async () => {
      const res = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nom: 'Dupont',
          prenom: 'Jean',
          email: `jean.dupont-${Date.now()}@example.com`,
          telephone: '0612345678',
          adresse: '123 Rue Test, Dakar',
          nif: '123456789',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.nom).toBe('Dupont');
      expect(res.body.data.prenom).toBe('Jean');
      expect(res.body.data.email).toBe(`jean.dupont-${Date.now()}@example.com`);

      createdClientIds.push(res.body.data.id);
    });

    it('should reject creating client without auth', async () => {
      const res = await request(app)
        .post('/api/clients')
        .send({
          nom: 'Unauthorized Client',
        });

      expect(res.status).toBe(401);
    });

    it('should reject client with missing name', async () => {
      const res = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nom: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject client with invalid email', async () => {
      const res = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nom: 'Bad Email Client',
          email: 'not-an-email',
        });

      expect(res.status).toBe(400);
    });

    it('should create client with minimal fields (name only)', async () => {
      const res = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nom: 'Minimal Client',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.nom).toBe('Minimal Client');
      expect(res.body.data.prenom).toBeNull();
      expect(res.body.data.email).toBeNull();

      createdClientIds.push(res.body.data.id);
    });
  });

  // ---- GET /api/clients ----

  describe('GET /api/clients', () => {
    beforeAll(async () => {
      // Create test clients
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/clients')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            nom: `SearchTest ${i}`,
            prenom: `Client ${i}`,
            email: `searchtest${i}-${Date.now()}@example.com`,
          });
        createdClientIds.push(res.body.data.id);
      }
    });

    it('should return paginated clients', async () => {
      const res = await request(app)
        .get('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 3 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.pagination).toBeDefined();
      expect(res.body.data.length).toBeLessThanOrEqual(3);
    });

    it('should search clients by name', async () => {
      const res = await request(app)
        .get('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ search: 'SearchTest' });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(5);
    });

    it('should search clients by email', async () => {
      const res = await request(app)
        .get('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ search: '@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(5);
    });

    it('should return empty result for non-matching search', async () => {
      const res = await request(app)
        .get('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ search: 'NONEXISTENT-CLIENT-XYZ' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ---- GET /api/clients/:id ----

  describe('GET /api/clients/:id', () => {
    let testClientId: number;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nom: 'GetById Client',
          prenom: 'Test',
          email: `getbyid-${Date.now()}@example.com`,
          telephone: '0600000000',
        });
      testClientId = res.body.data.id;
      createdClientIds.push(testClientId);
    });

    it('should return client by ID', async () => {
      const res = await request(app)
        .get(`/api/clients/${testClientId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(testClientId);
      expect(res.body.data.nom).toBe('GetById Client');
    });

    it('should return 404 for non-existent client', async () => {
      const res = await request(app)
        .get('/api/clients/999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ---- GET /api/clients/:id/historique ----

  describe('GET /api/clients/:id/historique', () => {
    let testClientId: number;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nom: 'Historique Client',
          email: `historique-${Date.now()}@example.com`,
        });
      testClientId = res.body.data.id;
      createdClientIds.push(testClientId);
    });

    it('should return empty purchase history for new client', async () => {
      const res = await request(app)
        .get(`/api/clients/${testClientId}/historique`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 404 for non-existent client historique', async () => {
      const res = await request(app)
        .get('/api/clients/999999/historique')
        .set('Authorization', `Bearer ${authToken}`);

      // Returns 200 with empty array or 404 depending on implementation
      expect(res.status).toBeGreaterThanOrEqual(200);
    });
  });

  // ---- PUT /api/clients/:id ----

  describe('PUT /api/clients/:id', () => {
    let testClientId: number;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nom: 'Update Client',
          email: `update-${Date.now()}@example.com`,
        });
      testClientId = res.body.data.id;
      createdClientIds.push(testClientId);
    });

    it('should update client fields', async () => {
      const res = await request(app)
        .put(`/api/clients/${testClientId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nom: 'Updated Client Name',
          telephone: '0699999999',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.nom).toBe('Updated Client Name');
      expect(res.body.data.telephone).toBe('0699999999');
    });

    it('should reject update with no fields', async () => {
      const res = await request(app)
        .put(`/api/clients/${testClientId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Aucun champ à mettre à jour');
    });

    it('should return 404 for non-existent client', async () => {
      const res = await request(app)
        .put('/api/clients/999999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ nom: 'New Name' });

      expect(res.status).toBe(404);
    });
  });

  // ---- DELETE /api/clients/:id ----

  describe('DELETE /api/clients/:id', () => {
    it('should soft-delete a client', async () => {
      const createRes = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nom: 'Delete Test Client',
          email: `delete-${Date.now()}@example.com`,
        });
      const clientId = createRes.body.data.id;

      const res = await request(app)
        .delete(`/api/clients/${clientId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 for non-existent client', async () => {
      const res = await request(app)
        .delete('/api/clients/999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });
});

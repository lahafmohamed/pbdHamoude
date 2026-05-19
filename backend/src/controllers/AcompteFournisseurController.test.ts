import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../server';

let authToken: string;

async function getAuthToken(): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({
    username: 'admin',
    password: 'admin123',
  });
  return res.body.data.token;
}

async function createTestFournisseur(): Promise<number> {
  const res = await request(app)
    .post('/api/tiers')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      raison_sociale: `API Test Fourn ${Date.now()}`,
      est_fournisseur: true,
      telephone: '00000000',
    });
  return res.body.data?.id;
}

describe('Acomptes Fournisseur API (Integration)', () => {
  beforeAll(async () => {
    authToken = await getAuthToken();
  });

  describe('POST /api/tiers/:id/acomptes-fournisseur', () => {
    it('rejects without auth', async () => {
      const res = await request(app)
        .post('/api/tiers/1/acomptes-fournisseur')
        .send({ montant: 1000, methode_paiement: 'virement' });
      expect(res.status).toBe(401);
    });

    it('rejects montant <= 0', async () => {
      const res = await request(app)
        .post('/api/tiers/1/acomptes-fournisseur')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ montant: 0, methode_paiement: 'virement' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Montant/);
    });

    it('rejects invalid methode_paiement', async () => {
      const res = await request(app)
        .post('/api/tiers/1/acomptes-fournisseur')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ montant: 1000, methode_paiement: 'bitcoin' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/methode_paiement/);
    });

    it('rejects unknown tiers', async () => {
      const res = await request(app)
        .post('/api/tiers/999999999/acomptes-fournisseur')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ montant: 1000, methode_paiement: 'virement' });
      expect(res.status).toBe(404);
    });

    it('rejects espece without magasin/session', async () => {
      const tiersId = await createTestFournisseur();
      const res = await request(app)
        .post(`/api/tiers/${tiersId}/acomptes-fournisseur`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ montant: 1000, methode_paiement: 'espece' });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/magasin|session/);
    });

    it('creates non-cash acompte fournisseur', async () => {
      const tiersId = await createTestFournisseur();
      const res = await request(app)
        .post(`/api/tiers/${tiersId}/acomptes-fournisseur`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          montant: 5000,
          methode_paiement: 'virement',
          reference_number: 'VIR-TEST-1',
        });
      expect(res.status).toBe(201);
      expect(res.body.data?.id).toBeDefined();
      expect(parseFloat(res.body.data.montant_restant)).toBe(5000);
      expect(res.body.data.mouvement_caisse_id).toBeNull();
    });

    it('honors idempotency_key on duplicate POST', async () => {
      const tiersId = await createTestFournisseur();
      const key = `idem-${Date.now()}`;
      const payload = { montant: 2000, methode_paiement: 'cheque', idempotency_key: key };

      const r1 = await request(app)
        .post(`/api/tiers/${tiersId}/acomptes-fournisseur`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);
      expect(r1.status).toBe(201);
      const firstId = r1.body.data.id;

      const r2 = await request(app)
        .post(`/api/tiers/${tiersId}/acomptes-fournisseur`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);
      expect(r2.status).toBe(200);
      expect(r2.body.idempotent).toBe(true);
      expect(r2.body.data.id).toBe(firstId);
    });
  });

  describe('GET /api/tiers/:id/acomptes-fournisseur/disponibles', () => {
    it('returns array', async () => {
      const tiersId = await createTestFournisseur();
      await request(app)
        .post(`/api/tiers/${tiersId}/acomptes-fournisseur`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ montant: 7500, methode_paiement: 'virement' });

      const res = await request(app)
        .get(`/api/tiers/${tiersId}/acomptes-fournisseur/disponibles`)
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].statut).toMatch(/disponible|partiellement_utilise/);
    });
  });

  describe('POST /api/acomptes/fournisseur/:id/apply', () => {
    it('rejects without body', async () => {
      const res = await request(app)
        .post('/api/acomptes/fournisseur/1/apply')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('rejects unknown acompte', async () => {
      const res = await request(app)
        .post('/api/acomptes/fournisseur/999999999/apply')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ facture_id: 1, montant: 100 });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/acomptes/fournisseur/:id/refund', () => {
    it('rejects invalid methode', async () => {
      const res = await request(app)
        .post('/api/acomptes/fournisseur/1/refund')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ montant: 100, methode_paiement: 'bitcoin' });
      expect(res.status).toBe(400);
    });

    it('rejects unknown acompte', async () => {
      const res = await request(app)
        .post('/api/acomptes/fournisseur/999999999/refund')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ montant: 100, methode_paiement: 'virement' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/caisse/audit', () => {
    it('rejects unauthenticated', async () => {
      const res = await request(app).get('/api/caisse/audit');
      expect(res.status).toBe(401);
    });

    it('returns summary + items + orphans_total', async () => {
      const res = await request(app)
        .get('/api/caisse/audit?limit=10')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(Array.isArray(res.body.summary)).toBe(true);
      expect(typeof res.body.orphans_total).toBe('number');
    });

    it('filters orphans_only', async () => {
      const res = await request(app)
        .get('/api/caisse/audit?orphans_only=true')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      for (const item of res.body.data) {
        expect(item.is_orphan).toBe(true);
      }
    });

    it('filters by source_kind', async () => {
      const res = await request(app)
        .get('/api/caisse/audit?source_kind=acompte_fournisseur')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      for (const item of res.body.data) {
        expect(item.source_kind).toBe('acompte_fournisseur');
      }
    });
  });
});

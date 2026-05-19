import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from './server';

describe('Auth API', () => {
  describe('POST /api/auth/login', () => {
    it('should reject missing credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({
        username: 'invalid',
        password: 'wrong',
      });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should login with valid credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({
        username: 'admin',
        password: 'admin123',
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.role).toBe('admin');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should reject unauthenticated requests', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('should return user info with valid token', async () => {
      // First login to get token
      const loginRes = await request(app).post('/api/auth/login').send({
        username: 'admin',
        password: 'admin123',
      });

      const token = loginRes.body.data.token;

      // Then use it
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.username).toBe('admin');
    });
  });
});

describe('Health Check', () => {
  it('should return ok status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

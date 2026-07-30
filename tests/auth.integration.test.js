/**
 * Integration tests for the auth flow, using an in-memory MongoDB.
 * Requires devDependencies: supertest, mongodb-memory-server.
 *
 * Run: npm test
 */
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_32_chars_minimum_ok';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32_chars_minimum_ok';
process.env.ENCRYPTION_KEY = 'a3f7c9e21b8d4f6a0c5e9d2b7a1f8e3c4d6b9a0e5f2c8d1b7a4e6c3f9b0d2e8a';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let app, mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await mongoose.connect(process.env.MONGO_URI);
  app = require('../src/app');
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('Auth API', () => {
  test('health check works', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('rejects OTP request with invalid phone', async () => {
    const res = await request(app).post('/api/v1/auth/send-otp').send({ phone: '123' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('accepts OTP request with valid phone', async () => {
    const res = await request(app).post('/api/v1/auth/send-otp').send({ phone: '9876543210' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('protected route rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  test('unknown route returns 404 envelope', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('attaches a request id header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

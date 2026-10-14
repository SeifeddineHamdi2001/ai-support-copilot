import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createAgent, createTestApp, resetDb } from '../../../../test/helpers';
import { hashPassword } from '../auth.service';
import { signAccessToken } from '../../../common/auth/auth';

describe('Auth API & AuthGuard (integration)', () => {
  const prisma = new PrismaClient();
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const testPassword = 'CorrectHorseBatteryStaple123!';
  const jwtSecret = 'test-jwt-secret-min-32-chars-length!!';

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/auth/login', () => {
    it('authenticates active user with valid credentials and returns access token', async () => {
      const passwordHash = await hashPassword(testPassword);
      const user = await createAgent(prisma, {
        email: 'alex.morgan@acme-support.test',
        name: 'Alex Morgan',
        role: 'AGENT',
        passwordHash,
      });

      const res = await http()
        .post('/api/v1/auth/login')
        .send({
          email: 'alex.morgan@acme-support.test',
          password: testPassword,
        })
        .expect(200);

      expect(res.body).toMatchObject({
        expiresIn: 28800,
        user: {
          id: user.id,
          email: 'alex.morgan@acme-support.test',
          name: 'Alex Morgan',
          role: 'AGENT',
          isActive: true,
        },
      });
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.accessToken.split('.')).toHaveLength(3);
    });

    it('matches email case-insensitively during sign-in', async () => {
      const passwordHash = await hashPassword(testPassword);
      await createAgent(prisma, {
        email: 'priya.shah@acme-support.test',
        passwordHash,
      });

      const res = await http()
        .post('/api/v1/auth/login')
        .send({
          email: '  PRIYA.SHAH@Acme-Support.TEST  ',
          password: testPassword,
        })
        .expect(200);

      expect(res.body.user.email).toBe('priya.shah@acme-support.test');
    });

    it('rejects an incorrect password with 401', async () => {
      const passwordHash = await hashPassword(testPassword);
      await createAgent(prisma, {
        email: 'test@acme-support.test',
        passwordHash,
      });

      const res = await http()
        .post('/api/v1/auth/login')
        .send({
          email: 'test@acme-support.test',
          password: 'WrongPassword999!',
        })
        .expect(401);

      expect(res.body.detail).toBe('Email or password is incorrect.');
      expect(res.body.errorCode).toBe('UNAUTHORIZED');
    });

    it('rejects an unknown email with 401', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@acme-support.test',
          password: testPassword,
        })
        .expect(401);

      expect(res.body.detail).toBe('Email or password is incorrect.');
      expect(res.body.errorCode).toBe('UNAUTHORIZED');
    });

    it('rejects an inactive user account even with the correct password', async () => {
      const passwordHash = await hashPassword(testPassword);
      await createAgent(prisma, {
        email: 'inactive@acme-support.test',
        passwordHash,
        isActive: false,
      });

      const res = await http()
        .post('/api/v1/auth/login')
        .send({
          email: 'inactive@acme-support.test',
          password: testPassword,
        })
        .expect(401);

      expect(res.body.detail).toBe('Email or password is incorrect.');
      expect(res.body.errorCode).toBe('UNAUTHORIZED');
    });

    it('rejects user accounts without a password hash configured', async () => {
      await createAgent(prisma, {
        email: 'nopass@acme-support.test',
        passwordHash: undefined,
      });

      const res = await http()
        .post('/api/v1/auth/login')
        .send({
          email: 'nopass@acme-support.test',
          password: testPassword,
        })
        .expect(401);

      expect(res.body.detail).toBe('Email or password is incorrect.');
      expect(res.body.errorCode).toBe('UNAUTHORIZED');
    });

    it('validates request payload schema (rejects missing fields with 400)', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({
          email: 'not-an-email',
          password: '',
        })
        .expect(400);

      const fields = res.body.errors.map((e: { field: string }) => e.field);
      expect(new Set(fields)).toEqual(new Set(['email', 'password']));
    });
  });

  describe('AuthGuard & Bearer authentication', () => {
    it('authorizes requests with a valid Bearer token', async () => {
      const passwordHash = await hashPassword(testPassword);
      await createAgent(prisma, {
        email: 'bearer@acme-support.test',
        passwordHash,
      });

      const loginRes = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'bearer@acme-support.test', password: testPassword })
        .expect(200);

      const token = loginRes.body.accessToken;

      const customerRes = await http()
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'cust-bearer@example.test',
          name: 'Bearer Customer',
        })
        .expect(201);

      expect(customerRes.body.email).toBe('cust-bearer@example.test');
    });

    it('rejects invalid or tampered Bearer tokens with 401', async () => {
      await http()
        .post('/api/v1/customers')
        .set('Authorization', 'Bearer invalid.tampered.token')
        .send({ email: 'cust@example.test', name: 'Cust' })
        .expect(401);
    });

    it('rejects tokens belonging to deactivated accounts with 401', async () => {
      const user = await createAgent(prisma, { isActive: true });
      const token = signAccessToken(
        { id: user.id, email: user.email, name: user.name, role: user.role },
        process.env.JWT_SECRET || jwtSecret,
      );

      // Deactivate user in DB
      await prisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });

      const res = await http()
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'cust@example.test', name: 'Cust' })
        .expect(401);

      expect(res.body.detail).toBe('This account is inactive.');
      expect(res.body.errorCode).toBe('UNAUTHORIZED');
    });

    it('enforces actor header validation when legacy X-User-Id is provided', async () => {
      // Non-UUID
      await http()
        .post('/api/v1/customers')
        .set('X-User-Id', 'not-a-uuid')
        .send({ email: 'c@x.test', name: 'C' })
        .expect(400);

      // Inactive or unknown agent UUID
      const fakeId = randomUUID();
      const res = await http()
        .post('/api/v1/customers')
        .set('X-User-Id', fakeId)
        .send({ email: 'c@x.test', name: 'C' })
        .expect(422);

      expect(res.body.errorCode).toBe('INVALID_ACTOR');
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createAgent, createTestApp, resetDb } from '../../../../test/helpers';
import { hashPassword } from '../../auth/auth.service';

describe('Users API (integration)', () => {
  const prisma = new PrismaClient();
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

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

  describe('Role authorization', () => {
    it('forbids AGENT from accessing user management endpoints (403)', async () => {
      const agent = await createAgent(prisma, { role: 'AGENT' });

      await http()
        .get('/api/v1/users')
        .set('X-User-Id', agent.id)
        .expect(403);

      await http()
        .post('/api/v1/users')
        .set('X-User-Id', agent.id)
        .send({
          name: 'New Teammate',
          email: 'teammate@acme-support.test',
          role: 'AGENT',
          password: 'LongSecurePassword123!',
        })
        .expect(403);

      await http()
        .patch('/api/v1/users')
        .set('X-User-Id', agent.id)
        .send({ id: agent.id, isActive: false })
        .expect(403);
    });

    it('forbids MANAGER from accessing user management endpoints (403)', async () => {
      const manager = await createAgent(prisma, { role: 'MANAGER' });

      await http()
        .get('/api/v1/users')
        .set('X-User-Id', manager.id)
        .expect(403);
    });

    it('rejects unauthenticated requests with 401', async () => {
      await http().get('/api/v1/users').expect(401);
    });
  });

  describe('GET /api/v1/users', () => {
    it('lists workspace users sorted by active status and name, omitting password hashes', async () => {
      const admin = await createAgent(prisma, {
        name: 'Zoe Admin',
        role: 'ADMIN',
        passwordHash: await hashPassword('AdminPass12345!'),
      });
      await createAgent(prisma, { name: 'Alice Agent', role: 'AGENT' });
      await createAgent(prisma, { name: 'Bob Inactive', role: 'AGENT', isActive: false });

      const res = await http()
        .get('/api/v1/users')
        .set('X-User-Id', admin.id)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(3);

      // Active users first, then alphabetically by name
      const names = res.body.map((u: { name: string }) => u.name);
      expect(names).toEqual(['Alice Agent', 'Zoe Admin', 'Bob Inactive']);

      // Ensure passwordHash is never leaked
      for (const user of res.body) {
        expect(user.passwordHash).toBeUndefined();
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
        expect(user).toHaveProperty('role');
        expect(user).toHaveProperty('isActive');
        expect(user).toHaveProperty('createdAt');
      }
    });
  });

  describe('POST /api/v1/users', () => {
    it('provisions a new user with hashed password and normalized email', async () => {
      const admin = await createAgent(prisma, { role: 'ADMIN' });

      const res = await http()
        .post('/api/v1/users')
        .set('X-User-Id', admin.id)
        .send({
          name: 'Dana Scully',
          email: '  Dana.Scully@Acme-Support.TEST  ',
          role: 'AGENT',
          password: 'SecretAgentPass123!',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Dana Scully',
        email: 'dana.scully@acme-support.test',
        role: 'AGENT',
        isActive: true,
      });
      expect(res.body.passwordHash).toBeUndefined();

      // Verify user in database has a valid passwordHash stored
      const createdDbUser = await prisma.user.findUnique({
        where: { id: res.body.id },
      });
      expect(createdDbUser?.passwordHash).toMatch(/^scrypt\$/);
    });

    it('rejects duplicate email with 409 Conflict', async () => {
      const admin = await createAgent(prisma, { role: 'ADMIN' });
      await createAgent(prisma, { email: 'existing@acme-support.test' });

      const res = await http()
        .post('/api/v1/users')
        .set('X-User-Id', admin.id)
        .send({
          name: 'Duplicate Guy',
          email: 'EXISTING@acme-support.test',
          role: 'AGENT',
          password: 'Password1234567!',
        })
        .expect(409);

      expect(res.body.detail).toBe('A user with this email already exists.');
    });

    it('validates minimum password length (must be >= 12 chars)', async () => {
      const admin = await createAgent(prisma, { role: 'ADMIN' });

      const res = await http()
        .post('/api/v1/users')
        .set('X-User-Id', admin.id)
        .send({
          name: 'Short Password',
          email: 'short@acme-support.test',
          role: 'AGENT',
          password: 'short',
        })
        .expect(400);

      const fields = res.body.errors.map((e: { field: string }) => e.field);
      expect(fields).toContain('password');
    });
  });

  describe('PATCH /api/v1/users', () => {
    it('updates role and active status', async () => {
      const admin = await createAgent(prisma, { role: 'ADMIN' });
      const targetUser = await createAgent(prisma, { role: 'AGENT', isActive: true });

      const res = await http()
        .patch('/api/v1/users')
        .set('X-User-Id', admin.id)
        .send({
          id: targetUser.id,
          role: 'MANAGER',
          isActive: false,
        })
        .expect(200);

      expect(res.body).toMatchObject({
        id: targetUser.id,
        role: 'MANAGER',
        isActive: false,
      });
    });

    it('returns 404 when attempting to update a nonexistent user', async () => {
      const admin = await createAgent(prisma, { role: 'ADMIN' });

      const res = await http()
        .patch('/api/v1/users')
        .set('X-User-Id', admin.id)
        .send({
          id: randomUUID(),
          role: 'AGENT',
        })
        .expect(404);

      expect(res.body.detail).toBe('User not found.');
    });

    it('protects last active admin invariant: prevents demoting the sole active admin', async () => {
      const soleAdmin = await createAgent(prisma, { role: 'ADMIN', isActive: true });

      const res = await http()
        .patch('/api/v1/users')
        .set('X-User-Id', soleAdmin.id)
        .send({
          id: soleAdmin.id,
          role: 'AGENT',
        })
        .expect(409);

      expect(res.body.detail).toBe('At least one active administrator must remain.');
    });

    it('protects last active admin invariant: prevents deactivating the sole active admin', async () => {
      const soleAdmin = await createAgent(prisma, { role: 'ADMIN', isActive: true });

      const res = await http()
        .patch('/api/v1/users')
        .set('X-User-Id', soleAdmin.id)
        .send({
          id: soleAdmin.id,
          isActive: false,
        })
        .expect(409);

      expect(res.body.detail).toBe('At least one active administrator must remain.');
    });

    it('allows demoting an admin if another active admin exists', async () => {
      const admin1 = await createAgent(prisma, { role: 'ADMIN', isActive: true });
      const admin2 = await createAgent(prisma, { role: 'ADMIN', isActive: true });

      const res = await http()
        .patch('/api/v1/users')
        .set('X-User-Id', admin1.id)
        .send({
          id: admin2.id,
          role: 'AGENT',
        })
        .expect(200);

      expect(res.body.role).toBe('AGENT');
    });
  });
});

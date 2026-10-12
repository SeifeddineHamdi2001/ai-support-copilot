import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createAgent, createCustomer, createTestApp, resetDb } from '../../../../test/helpers';

describe('Customers and agents API (integration)', () => {
  const prisma = new PrismaClient();
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => resetDb(prisma));

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
    await prisma.$disconnect();
  });

  describe('customers', () => {
    it('creates a customer with a normalized email', async () => {
      const res = await http()
        .post('/api/v1/customers')
        .send({
          email: '  Dana@Globex.TEST ',
          name: 'Dana Scully',
          company: 'Globex',
          tier: 'PREMIUM',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        email: 'dana@globex.test',
        name: 'Dana Scully',
        tier: 'PREMIUM',
        ticketCount: 0,
      });
    });

    it('defaults tier to STANDARD and rejects invalid input with per-field errors', async () => {
      const ok = await http()
        .post('/api/v1/customers')
        .send({ email: 'a@b.test', name: 'A' })
        .expect(201);
      expect(ok.body.tier).toBe('STANDARD');

      const res = await http()
        .post('/api/v1/customers')
        .send({ email: 'not-an-email', name: '', tier: 'GOLD' })
        .expect(400);
      const fields = res.body.errors.map((e: { field: string }) => e.field);
      expect(new Set(fields)).toEqual(new Set(['email', 'name', 'tier']));
    });

    it('maps a duplicate email (Prisma P2002) to 409 UNIQUE_VIOLATION', async () => {
      await http().post('/api/v1/customers').send({ email: 'dup@x.test', name: 'One' }).expect(201);
      const res = await http()
        .post('/api/v1/customers')
        .send({ email: 'DUP@x.test', name: 'Two' })
        .expect(409);
      expect(res.body).toMatchObject({
        errorCode: 'UNIQUE_VIOLATION',
        errors: [{ field: 'email', message: 'must be unique' }],
      });
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    });

    it('lists with search, tier filter and pagination', async () => {
      await createCustomer(prisma, { name: 'Zed Zulu', tier: 'VIP' });
      await createCustomer(prisma, { name: 'Amy Alpha', company: 'Initech' });
      await createCustomer(prisma, { name: 'Bo Bravo' });

      const all = await http().get('/api/v1/customers').expect(200);
      expect(all.body.items.map((c: { name: string }) => c.name)).toEqual([
        'Amy Alpha',
        'Bo Bravo',
        'Zed Zulu',
      ]);
      expect(all.body.meta).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });

      const vip = await http().get('/api/v1/customers').query({ tier: 'VIP' }).expect(200);
      expect(vip.body.items.map((c: { name: string }) => c.name)).toEqual(['Zed Zulu']);

      const search = await http().get('/api/v1/customers').query({ q: 'initech' }).expect(200);
      expect(search.body.items.map((c: { name: string }) => c.name)).toEqual(['Amy Alpha']);

      const page = await http()
        .get('/api/v1/customers')
        .query({ limit: 1, page: 3, sort: '-name' })
        .expect(200);
      expect(page.body.items.map((c: { name: string }) => c.name)).toEqual(['Amy Alpha']);
    });

    it('updates a customer; null clears company but not name', async () => {
      const c = await createCustomer(prisma, { company: 'Old Co' });
      const res = await http()
        .patch(`/api/v1/customers/${c.id}`)
        .send({ company: null, tier: 'VIP' })
        .expect(200);
      expect(res.body).toMatchObject({ company: null, tier: 'VIP' });

      await http().patch(`/api/v1/customers/${c.id}`).send({ name: null }).expect(400);
      await http().patch(`/api/v1/customers/${randomUUID()}`).send({ name: 'X' }).expect(404);
    });

    it('refuses to delete a customer with tickets (409), deletes one without (204)', async () => {
      const withTickets = await createCustomer(prisma);
      await http()
        .post('/api/v1/tickets')
        .send({ customerId: withTickets.id, subject: 'Help me', body: 'Something is broken here.' })
        .expect(201);
      const res = await http().delete(`/api/v1/customers/${withTickets.id}`).expect(409);
      expect(res.body.errorCode).toBe('CUSTOMER_HAS_TICKETS');

      const lonely = await createCustomer(prisma);
      await http().delete(`/api/v1/customers/${lonely.id}`).expect(204);
      const gone = await http().get(`/api/v1/customers/${lonely.id}`).expect(404);
      expect(gone.body.errorCode).toBe('CUSTOMER_NOT_FOUND');
    });
  });

  describe('agents', () => {
    it('lists active agents only, sorted by name', async () => {
      await createAgent(prisma, { name: 'Zoe', role: 'LEAD' });
      await createAgent(prisma, { name: 'Adam' });
      await createAgent(prisma, { name: 'Retired', isActive: false });

      const res = await http().get('/api/v1/agents').expect(200);
      expect(res.body.map((a: { name: string }) => a.name)).toEqual(['Adam', 'Zoe']);
      expect(res.body[1]).toMatchObject({ role: 'LEAD', isActive: true });
    });
  });

  it('returns Problem Details for unknown routes', async () => {
    const res = await http().get('/api/v1/nope').expect(404);
    expect(res.body).toMatchObject({
      errorCode: 'NOT_FOUND',
      status: 404,
      instance: '/api/v1/nope',
    });
  });
});

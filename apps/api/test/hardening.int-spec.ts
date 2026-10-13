import { INestApplication } from '@nestjs/common';
import { Customer, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createCustomer, createTestApp, resetDb } from './helpers';

/** Cross-cutting protections: AI rate limit, input sanitising and size limits. */
describe('Hardening (integration)', () => {
  const prisma = new PrismaClient();
  let app: INestApplication;
  let customer: Customer;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp({ rateLimit: 2 });
  });

  beforeEach(async () => {
    await resetDb(prisma);
    customer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
    await prisma.$disconnect();
  });

  it('rate-limits AI routes with 429 Problem Details and Retry-After, but not plain CRUD', async () => {
    const t = (
      await http()
        .post('/api/v1/tickets')
        .send({
          customerId: customer.id,
          subject: 'Invoice copy',
          body: 'Please resend my invoice.',
        })
        .expect(201)
    ).body as { id: string };

    await http().post(`/api/v1/tickets/${t.id}/classify`).expect(200);
    await http().post(`/api/v1/tickets/${t.id}/classify`).expect(200);
    const res = await http().post(`/api/v1/tickets/${t.id}/classify`).expect(429);

    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.headers['retry-after']).toMatch(/^\d+$/);
    expect(res.body).toMatchObject({
      status: 429,
      errorCode: 'RATE_LIMITED',
      title: 'Too many requests',
    });
    // The throttled call did not run: still two classifications from /classify plus the one on create.
    expect(await prisma.aiClassification.count({ where: { ticketId: t.id } })).toBe(3);

    for (let i = 0; i < 4; i++) await http().get(`/api/v1/tickets/${t.id}`).expect(200);
  });

  it('strips HTML and control characters from ticket text before storing it', async () => {
    const res = await http()
      .post('/api/v1/tickets')
      .send({
        customerId: customer.id,
        subject: '  <b>Login</b> broken\u0007 ',
        body: 'I cannot log in.<br>Error: <script>alert(1)</script>\u0000 since today‮.',
      })
      .expect(201);

    expect(res.body.subject).toBe('Login broken');
    expect(res.body.body).toBe('I cannot log in.\nError: alert(1) since today.');
    expect(res.body.messages[0].body).toBe(res.body.body);
  });

  it('applies length limits to the sanitised text', async () => {
    const empty = await http()
      .post('/api/v1/tickets')
      .send({ customerId: customer.id, subject: '<p></p>', body: 'Body that is long enough.' })
      .expect(400);
    expect(empty.body.errors).toEqual([expect.objectContaining({ field: 'subject' })]);

    await http()
      .post('/api/v1/tickets')
      .send({
        customerId: customer.id,
        subject: 'x'.repeat(201),
        body: 'Body that is long enough.',
      })
      .expect(400);
  });

  it('rejects bodies over the 1 MB JSON limit with 413 Problem Details', async () => {
    const res = await http()
      .post('/api/v1/kb/documents')
      .send({ title: 'Huge', category: 'misc', content: 'x'.repeat(1_100_000) })
      .expect(413);
    expect(res.body).toMatchObject({ status: 413, errorCode: 'PAYLOAD_TOO_LARGE' });
  });
});

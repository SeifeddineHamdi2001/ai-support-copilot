import { INestApplication } from '@nestjs/common';
import { Customer, PrismaClient, User } from '@prisma/client';
import request from 'supertest';
import { createAgent, createCustomer, createTestApp, resetDb } from './helpers';

/** Cross-cutting protections: AI rate limit, input sanitising and size limits. */
describe('Hardening (integration)', () => {
  const prisma = new PrismaClient();
  let app: INestApplication;
  let customer: Customer;
  let agent: User;

  const http = () => request(app.getHttpServer());
  const asAgent = () => ({ 'X-User-Id': agent.id });

  beforeAll(async () => {
    app = await createTestApp({ rateLimit: 2 });
  });

  beforeEach(async () => {
    await resetDb(prisma);
    agent = await createAgent(prisma);
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

    await http().post(`/api/v1/tickets/${t.id}/classify`).set(asAgent()).expect(200);
    await http().post(`/api/v1/tickets/${t.id}/classify`).set(asAgent()).expect(200);
    const res = await http().post(`/api/v1/tickets/${t.id}/classify`).set(asAgent()).expect(429);

    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.headers['retry-after']).toMatch(/^\d+$/);
    expect(res.body).toMatchObject({
      status: 429,
      errorCode: 'RATE_LIMITED',
      title: 'Too many requests',
    });
    // The throttled call did not run: still two classifications from /classify plus the one on create.
    expect(await prisma.aiClassification.count({ where: { ticketId: t.id } })).toBe(3);

    for (let i = 0; i < 4; i++) await http().get(`/api/v1/tickets/${t.id}`).set(asAgent()).expect(200);
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

  it('rate-limits knowledge search and draft generation with Retry-After', async () => {
    const t = (
      await http()
        .post('/api/v1/tickets')
        .send({
          customerId: customer.id,
          subject: 'Invoice help',
          body: 'Please explain my invoice total.',
        })
        .expect(201)
    ).body as { id: string };

    await http().post('/api/v1/kb/search').set(asAgent()).send({ query: 'invoice' }).expect(200);
    await http().post('/api/v1/kb/search').set(asAgent()).send({ query: 'billing' }).expect(200);
    const searchLimit = await http()
      .post('/api/v1/kb/search')
      .set(asAgent())
      .send({ query: 'refund' })
      .expect(429);
    expect(searchLimit.headers['retry-after']).toMatch(/^\d+$/);
    expect(searchLimit.body.errorCode).toBe('RATE_LIMITED');

    await http().post(`/api/v1/tickets/${t.id}/drafts`).set(asAgent()).expect(201);
    await http().post(`/api/v1/tickets/${t.id}/drafts`).set(asAgent()).expect(201);
    const draftLimit = await http().post(`/api/v1/tickets/${t.id}/drafts`).set(asAgent()).expect(429);
    expect(draftLimit.headers['retry-after']).toMatch(/^\d+$/);
    expect(draftLimit.body.errorCode).toBe('RATE_LIMITED');
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
      .set(asAgent())
      .send({ title: 'Huge', category: 'misc', content: 'x'.repeat(1_100_000) })
      .expect(413);
    expect(res.body).toMatchObject({ status: 413, errorCode: 'PAYLOAD_TOO_LARGE' });
  });
});

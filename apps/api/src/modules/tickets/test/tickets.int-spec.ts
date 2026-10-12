import { INestApplication } from '@nestjs/common';
import { Customer, PrismaClient, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createAgent, createCustomer, createTestApp, resetDb } from '../../../../test/helpers';
import { UnavailableLlmProvider } from '../../../../test/scripted-llm.provider';

/**
 * Ticket core behaviour. The LLM is unavailable here, so auto-classification records a FAILED run and
 * leaves every ticket exactly as created (version 1, MEDIUM/DEFAULT): these tests stay about tickets, and
 * they double as proof that creation never depends on the AI. The AI path is in ticket-classification.
 */
describe('Tickets API (integration)', () => {
  const prisma = new PrismaClient();
  let app: INestApplication;
  let alice: User;
  let bob: User;
  let customer: Customer;

  const http = () => request(app.getHttpServer());
  const as = (user: User) => ({ 'X-User-Id': user.id });

  const createTicket = async (overrides: Record<string, unknown> = {}) => {
    const res = await http()
      .post('/api/v1/tickets')
      .send({
        customerId: customer.id,
        subject: 'Charged twice for October',
        body: 'My card was charged twice for the October invoice. Please refund one.',
        channel: 'EMAIL',
        ...overrides,
      })
      .expect(201);
    return res.body as { id: string; version: number; number: number };
  };

  beforeAll(async () => {
    app = await createTestApp({ llm: new UnavailableLlmProvider() });
  });

  beforeEach(async () => {
    await resetDb(prisma);
    alice = await createAgent(prisma, { name: 'Alice Agent' });
    bob = await createAgent(prisma, { name: 'Bob Agent' });
    customer = await createCustomer(prisma, { tier: 'VIP', name: 'Vera VIP' });
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
    await prisma.$disconnect();
  });

  describe('POST /tickets', () => {
    it('creates a ticket with its first message, SLA and a CREATED event in one write', async () => {
      const before = Date.now();
      const res = await http()
        .post('/api/v1/tickets')
        .set(as(alice))
        .send({
          customerId: customer.id,
          subject: '  Cannot log in after password reset  ',
          body: 'I reset my password and now the login page says invalid credentials.',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        number: expect.any(Number),
        subject: 'Cannot log in after password reset',
        status: 'OPEN',
        priority: 'MEDIUM',
        prioritySource: 'DEFAULT',
        intent: null,
        channel: 'WEB',
        version: 1,
        assignee: null,
        customer: { id: customer.id, tier: 'VIP' },
        allowedTransitions: ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'ESCALATED', 'RESOLVED'],
      });
      expect(res.body.messages).toEqual([
        expect.objectContaining({ authorType: 'CUSTOMER', authorId: customer.id }),
      ]);
      // VIP SLA is 4 hours.
      const sla = new Date(res.body.slaDueAt).getTime();
      expect(sla - before).toBeGreaterThanOrEqual(4 * 3_600_000 - 1_000);
      expect(sla - before).toBeLessThan(4 * 3_600_000 + 60_000);

      const events = await prisma.ticketEvent.findMany({ where: { ticketId: res.body.id } });
      expect(events).toEqual([
        expect.objectContaining({
          type: 'CREATED',
          actorType: 'USER',
          actorId: alice.id,
          toValue: 'OPEN',
        }),
      ]);
    });

    it('records a SYSTEM actor when no X-User-Id is sent (intake channel)', async () => {
      const ticket = await createTicket();
      const event = await prisma.ticketEvent.findFirstOrThrow({ where: { ticketId: ticket.id } });
      expect(event).toMatchObject({ type: 'CREATED', actorType: 'SYSTEM', actorId: null });
    });

    it('rejects invalid input with 400 Problem Details listing each field', async () => {
      const res = await http()
        .post('/api/v1/tickets')
        .send({
          customerId: 'not-a-uuid',
          subject: 'x'.repeat(201),
          body: 'short',
          channel: 'PIGEON',
          priority: 'URGENT',
        })
        .expect(400);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({
        type: 'https://errors.copilot.local/validation-failed',
        title: 'Validation failed',
        status: 400,
        errorCode: 'VALIDATION_FAILED',
        instance: '/api/v1/tickets',
      });
      const fields = new Set(res.body.errors.map((e: { field: string }) => e.field));
      // `priority` is not accepted on create (forbidNonWhitelisted): new tickets start at DEFAULT priority.
      expect(fields).toEqual(new Set(['customerId', 'subject', 'body', 'channel', 'priority']));
      expect(await prisma.ticket.count()).toBe(0);
    });

    it('rejects a malformed JSON body with 400 Problem Details', async () => {
      const res = await http()
        .post('/api/v1/tickets')
        .set('Content-Type', 'application/json')
        .send('{"subject": ')
        .expect(400);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({ errorCode: 'VALIDATION_FAILED', status: 400 });
    });

    it('returns 422 for an unknown customer', async () => {
      const res = await http()
        .post('/api/v1/tickets')
        .send({ customerId: randomUUID(), subject: 'Hello there', body: 'A perfectly valid body.' })
        .expect(422);
      expect(res.body).toMatchObject({
        errorCode: 'INVALID_CUSTOMER',
        errors: [{ field: 'customerId' }],
      });
    });
  });

  describe('GET /tickets/:id', () => {
    it('returns 404 Problem Details for an unknown ticket and 400 for a non-UUID id', async () => {
      const id = randomUUID();
      const res = await http().get(`/api/v1/tickets/${id}`).expect(404);
      expect(res.body).toMatchObject({
        errorCode: 'TICKET_NOT_FOUND',
        instance: `/api/v1/tickets/${id}`,
      });

      const bad = await http().get('/api/v1/tickets/123').expect(400);
      expect(bad.body.errorCode).toBe('VALIDATION_FAILED');
    });
  });

  describe('POST /tickets/:id/status', () => {
    it('applies a valid transition, bumps the version and writes a STATUS_CHANGED event', async () => {
      const t = await createTicket();
      const res = await http()
        .post(`/api/v1/tickets/${t.id}/status`)
        .set(as(alice))
        .send({ version: 1, status: 'IN_PROGRESS', note: 'Looking into it' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'IN_PROGRESS', version: 2 });

      const resolved = await http()
        .post(`/api/v1/tickets/${t.id}/status`)
        .set(as(alice))
        .send({ version: 2, status: 'RESOLVED' })
        .expect(200);
      expect(resolved.body).toMatchObject({ status: 'RESOLVED', version: 3 });
      expect(resolved.body.resolvedAt).not.toBeNull();
      expect(resolved.body.allowedTransitions).toEqual(['CLOSED', 'OPEN']);

      const reopened = await http()
        .post(`/api/v1/tickets/${t.id}/status`)
        .set(as(alice))
        .send({ version: 3, status: 'OPEN' })
        .expect(200);
      expect(reopened.body).toMatchObject({ status: 'OPEN', resolvedAt: null, version: 4 });

      const events = await prisma.ticketEvent.findMany({
        where: { ticketId: t.id, type: 'STATUS_CHANGED' },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((e) => [e.fromValue, e.toValue])).toEqual([
        ['OPEN', 'IN_PROGRESS'],
        ['IN_PROGRESS', 'RESOLVED'],
        ['RESOLVED', 'OPEN'],
      ]);
      expect(events[0]).toMatchObject({
        actorType: 'USER',
        actorId: alice.id,
        metadata: { note: 'Looking into it' },
      });
    });

    it('rejects an invalid transition with 409 and changes nothing', async () => {
      const t = await createTicket();
      const res = await http()
        .post(`/api/v1/tickets/${t.id}/status`)
        .set(as(alice))
        .send({ version: 1, status: 'CLOSED' })
        .expect(409);

      expect(res.body).toMatchObject({
        status: 409,
        errorCode: 'INVALID_STATUS_TRANSITION',
        title: 'Invalid status transition',
        errors: [{ field: 'status' }],
      });
      expect(res.body.detail).toContain(
        'Allowed: IN_PROGRESS, WAITING_ON_CUSTOMER, ESCALATED, RESOLVED',
      );

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect(row).toMatchObject({ status: 'OPEN', version: 1 });
      expect(await prisma.ticketEvent.count({ where: { ticketId: t.id } })).toBe(1);
    });

    it('treats CLOSED as terminal', async () => {
      const t = await createTicket();
      for (const [version, status] of [
        [1, 'RESOLVED'],
        [2, 'CLOSED'],
      ] as const) {
        await http()
          .post(`/api/v1/tickets/${t.id}/status`)
          .set(as(alice))
          .send({ version, status })
          .expect(200);
      }
      const res = await http()
        .post(`/api/v1/tickets/${t.id}/status`)
        .set(as(alice))
        .send({ version: 3, status: 'OPEN' })
        .expect(409);
      expect(res.body.errorCode).toBe('INVALID_STATUS_TRANSITION');
      expect(res.body.detail).toMatch(/terminal/);

      const assign = await http()
        .post(`/api/v1/tickets/${t.id}/assign`)
        .set(as(alice))
        .send({ version: 3, assigneeId: bob.id })
        .expect(409);
      expect(assign.body.errorCode).toBe('TICKET_CLOSED');
    });

    it('rejects a stale version with 409 TICKET_VERSION_CONFLICT and keeps the newer state', async () => {
      const t = await createTicket();
      await http()
        .post(`/api/v1/tickets/${t.id}/status`)
        .set(as(alice))
        .send({ version: 1, status: 'IN_PROGRESS' })
        .expect(200);

      // Bob still holds version 1.
      const res = await http()
        .post(`/api/v1/tickets/${t.id}/status`)
        .set(as(bob))
        .send({ version: 1, status: 'WAITING_ON_CUSTOMER' })
        .expect(409);
      expect(res.body).toMatchObject({
        errorCode: 'TICKET_VERSION_CONFLICT',
        title: 'Version conflict',
        type: 'https://errors.copilot.local/ticket-version-conflict',
      });
      expect(res.body.detail).toMatch(/version 1, current is 2/);

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect(row).toMatchObject({ status: 'IN_PROGRESS', version: 2 });
      expect(
        await prisma.ticketEvent.count({ where: { ticketId: t.id, type: 'STATUS_CHANGED' } }),
      ).toBe(1);
    });

    it('lets exactly one of two concurrent writers with the same version win', async () => {
      const t = await createTicket();
      const [a, b] = await Promise.all([
        http()
          .post(`/api/v1/tickets/${t.id}/status`)
          .set(as(alice))
          .send({ version: 1, status: 'IN_PROGRESS' }),
        http()
          .post(`/api/v1/tickets/${t.id}/status`)
          .set(as(bob))
          .send({ version: 1, status: 'ESCALATED' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect(row.version).toBe(2);
      const events = await prisma.ticketEvent.findMany({
        where: { ticketId: t.id, type: 'STATUS_CHANGED' },
      });
      expect(events).toHaveLength(1);
      expect(events[0].toValue).toBe(row.status);
    });

    it('requires a valid acting agent', async () => {
      const t = await createTicket();
      const url = `/api/v1/tickets/${t.id}/status`;
      const body = { version: 1, status: 'IN_PROGRESS' };

      const missing = await http().post(url).send(body).expect(400);
      expect(missing.body.errors).toEqual([expect.objectContaining({ field: 'X-User-Id' })]);

      const unknown = await http().post(url).set('X-User-Id', randomUUID()).send(body).expect(422);
      expect(unknown.body.errorCode).toBe('INVALID_ACTOR');

      await http().post(url).set('X-User-Id', 'nope').send(body).expect(400);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).version).toBe(1);
    });
  });

  describe('POST /tickets/:id/assign', () => {
    it('keeps a full assignment history across assign, reassign and unassign', async () => {
      const t = await createTicket();
      const assign = (version: number, assigneeId: string | null) =>
        http().post(`/api/v1/tickets/${t.id}/assign`).set(as(alice)).send({ version, assigneeId });

      const r1 = await assign(1, alice.id).expect(200);
      expect(r1.body).toMatchObject({
        assigneeId: alice.id,
        assignee: { name: 'Alice Agent' },
        version: 2,
      });
      // Assigning does not change status implicitly.
      expect(r1.body.status).toBe('OPEN');

      const r2 = await assign(2, bob.id).expect(200);
      expect(r2.body).toMatchObject({ assigneeId: bob.id, version: 3 });

      // Assigning to the current assignee is an idempotent no-op (no version bump, no event).
      const same = await assign(3, bob.id).expect(200);
      expect(same.body.version).toBe(3);

      const r3 = await assign(3, null).expect(200);
      expect(r3.body).toMatchObject({ assigneeId: null, assignee: null, version: 4 });

      // Newest first in the API response.
      expect(
        r3.body.assignments.map((a: { assignee: { id: string }; unassignedAt: string | null }) => [
          a.assignee.id,
          a.unassignedAt !== null,
        ]),
      ).toEqual([
        [bob.id, true],
        [alice.id, true],
      ]);

      const rows = await prisma.ticketAssignment.findMany({
        where: { ticketId: t.id },
        orderBy: { assignedAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.assignedById === alice.id && r.unassignedAt !== null)).toBe(true);
      // The first assignment ended exactly when the second began.
      expect(rows[0].unassignedAt!.getTime()).toBe(rows[1].assignedAt.getTime());

      const events = await prisma.ticketEvent.findMany({
        where: { ticketId: t.id, type: { in: ['ASSIGNED', 'UNASSIGNED'] } },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((e) => [e.type, e.fromValue, e.toValue])).toEqual([
        ['ASSIGNED', null, alice.id],
        ['ASSIGNED', alice.id, bob.id],
        ['UNASSIGNED', bob.id, null],
      ]);
    });

    it('rejects an inactive or unknown assignee with 422 and writes nothing', async () => {
      const t = await createTicket();
      const retired = await createAgent(prisma, { isActive: false });
      for (const assigneeId of [retired.id, randomUUID()]) {
        const res = await http()
          .post(`/api/v1/tickets/${t.id}/assign`)
          .set(as(alice))
          .send({ version: 1, assigneeId })
          .expect(422);
        expect(res.body).toMatchObject({
          errorCode: 'INVALID_ASSIGNEE',
          errors: [{ field: 'assigneeId' }],
        });
      }
      expect(await prisma.ticketAssignment.count()).toBe(0);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).version).toBe(1);
    });

    it('requires assigneeId (null to unassign)', async () => {
      const t = await createTicket();
      const res = await http()
        .post(`/api/v1/tickets/${t.id}/assign`)
        .set(as(alice))
        .send({ version: 1 })
        .expect(400);
      expect(res.body.errors).toEqual([expect.objectContaining({ field: 'assigneeId' })]);
    });
  });

  describe('PATCH /tickets/:id', () => {
    it('sets a MANUAL priority and a corrected intent, each with an audit event', async () => {
      const t = await createTicket();
      const res = await http()
        .patch(`/api/v1/tickets/${t.id}`)
        .set(as(bob))
        .send({ version: 1, priority: 'URGENT', intent: 'REFUND_REQUEST' })
        .expect(200);
      expect(res.body).toMatchObject({
        priority: 'URGENT',
        prioritySource: 'MANUAL',
        intent: 'REFUND_REQUEST',
        version: 2,
      });

      const events = await prisma.ticketEvent.findMany({
        where: { ticketId: t.id, type: { in: ['PRIORITY_CHANGED', 'INTENT_CHANGED'] } },
      });
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'PRIORITY_CHANGED',
            fromValue: 'MEDIUM',
            toValue: 'URGENT',
            actorId: bob.id,
            metadata: { fromSource: 'DEFAULT', toSource: 'MANUAL' },
          }),
          expect.objectContaining({
            type: 'INTENT_CHANGED',
            fromValue: null,
            toValue: 'REFUND_REQUEST',
          }),
        ]),
      );
    });

    it('rejects an empty update and a null priority with 400', async () => {
      const t = await createTicket();
      await http().patch(`/api/v1/tickets/${t.id}`).set(as(bob)).send({ version: 1 }).expect(400);
      const res = await http()
        .patch(`/api/v1/tickets/${t.id}`)
        .set(as(bob))
        .send({ version: 1, priority: null })
        .expect(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'priority' })]),
      );
    });

    it('rejects a stale version with 409', async () => {
      const t = await createTicket();
      await http()
        .patch(`/api/v1/tickets/${t.id}`)
        .set(as(bob))
        .send({ version: 1, priority: 'HIGH' })
        .expect(200);
      const res = await http()
        .patch(`/api/v1/tickets/${t.id}`)
        .set(as(alice))
        .send({ version: 1, priority: 'LOW' })
        .expect(409);
      expect(res.body.errorCode).toBe('TICKET_VERSION_CONFLICT');
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).priority).toBe(
        'HIGH',
      );
    });
  });

  describe('GET /tickets/:id/events', () => {
    it('returns the full audit timeline in order with resolved actor names', async () => {
      const t = await createTicket();
      const post = (path: string, body: object) =>
        http().post(`/api/v1/tickets/${t.id}/${path}`).set(as(alice)).send(body).expect(200);
      await post('assign', { version: 1, assigneeId: bob.id });
      await post('status', { version: 2, status: 'IN_PROGRESS' });
      await http()
        .patch(`/api/v1/tickets/${t.id}`)
        .set(as(bob))
        .send({ version: 3, priority: 'HIGH' })
        .expect(200);
      await post('status', { version: 4, status: 'RESOLVED' });

      const res = await http().get(`/api/v1/tickets/${t.id}/events`).expect(200);
      expect(res.body.map((e: { type: string }) => e.type)).toEqual([
        'CREATED',
        'ASSIGNED',
        'STATUS_CHANGED',
        'PRIORITY_CHANGED',
        'STATUS_CHANGED',
      ]);
      expect(res.body[0]).toMatchObject({ actorType: 'SYSTEM', actor: null });
      expect(res.body[1]).toMatchObject({
        actorType: 'USER',
        actor: { id: alice.id, name: 'Alice Agent' },
        toValue: bob.id,
      });
      expect(res.body[3]).toMatchObject({
        actor: { name: 'Bob Agent' },
        fromValue: 'MEDIUM',
        toValue: 'HIGH',
      });
      expect(res.body[4]).toMatchObject({ fromValue: 'IN_PROGRESS', toValue: 'RESOLVED' });

      // Every successful mutation wrote exactly one event and bumped the version once.
      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect(row.version).toBe(res.body.length);
    });

    it('returns 404 for an unknown ticket', async () => {
      await http().get(`/api/v1/tickets/${randomUUID()}/events`).expect(404);
    });
  });

  describe('GET /tickets', () => {
    it('filters, searches, sorts and paginates', async () => {
      const standard = await createCustomer(prisma);
      const a = await createTicket({ subject: 'Refund for duplicate charge' });
      const b = await createTicket({ subject: 'SSO login loop', customerId: standard.id });
      const c = await createTicket({ subject: 'Export my data' });
      await http()
        .post(`/api/v1/tickets/${b.id}/assign`)
        .set(as(alice))
        .send({ version: 1, assigneeId: alice.id })
        .expect(200);
      await http()
        .post(`/api/v1/tickets/${c.id}/status`)
        .set(as(alice))
        .send({ version: 1, status: 'IN_PROGRESS' })
        .expect(200);
      await http()
        .patch(`/api/v1/tickets/${a.id}`)
        .set(as(alice))
        .send({ version: 1, priority: 'URGENT' })
        .expect(200);

      const list = (query: Record<string, string | number>) =>
        http()
          .get('/api/v1/tickets')
          .query(query)
          .expect(200)
          .then((r) => r.body);
      const subjects = (body: { items: { subject: string }[] }) => body.items.map((i) => i.subject);

      const all = await list({});
      expect(all.meta).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
      // Default sort: newest first.
      expect(subjects(all)).toEqual([
        'Export my data',
        'SSO login loop',
        'Refund for duplicate charge',
      ]);
      expect(all.items[0].customer).toMatchObject({ name: 'Vera VIP', tier: 'VIP' });

      expect(subjects(await list({ status: 'IN_PROGRESS' }))).toEqual(['Export my data']);
      expect(
        subjects(await list({ status: 'OPEN,IN_PROGRESS', assigneeId: 'unassigned' })),
      ).toHaveLength(2);
      expect(subjects(await list({ assigneeId: alice.id }))).toEqual(['SSO login loop']);
      expect(subjects(await list({ customerId: standard.id }))).toEqual(['SSO login loop']);
      expect(subjects(await list({ priority: 'URGENT' }))).toEqual(['Refund for duplicate charge']);
      expect(subjects(await list({ q: 'sso' }))).toEqual(['SSO login loop']);
      expect(subjects(await list({ q: `#${c.number}` }))).toEqual(['Export my data']);
      expect(subjects(await list({ sort: '-priority' }))[0]).toBe('Refund for duplicate charge');

      const page2 = await list({ limit: 2, page: 2, sort: 'createdAt' });
      expect(page2.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
      expect(subjects(page2)).toEqual(['Export my data']);
    });

    it('rejects invalid list parameters with 400', async () => {
      for (const query of [
        { limit: 101 },
        { page: 0 },
        { status: 'NOPE' },
        { sort: 'body' },
        { assigneeId: 'x' },
      ]) {
        const res = await http().get('/api/v1/tickets').query(query).expect(400);
        expect(res.body.errorCode).toBe('VALIDATION_FAILED');
      }
    });
  });
});

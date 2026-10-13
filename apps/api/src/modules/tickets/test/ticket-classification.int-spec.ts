import { TicketClassificationSchema } from '@copilot/shared';
import { INestApplication } from '@nestjs/common';
import { Customer, PrismaClient, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PROMPT_INJECTION_TICKET_ID, TICKETS } from '../../../../prisma/seed-data';
import { createAgent, createCustomer, createTestApp, resetDb } from '../../../../test/helpers';
import {
  ScriptedLlmProvider,
  UnavailableLlmProvider,
} from '../../../../test/scripted-llm.provider';
import type { LlmProvider, StructuredRequest } from '../../ai/providers/llm-provider';
import { MockLlmProvider } from '../../ai/providers/mock-llm.provider';

/** Delegates to a provider chosen per test, so one app instance covers every AI behaviour. */
class SwitchableLlm implements LlmProvider {
  target: LlmProvider = new MockLlmProvider();
  get name() {
    return this.target.name;
  }
  get model() {
    return this.target.model;
  }
  generateStructured<T>(req: StructuredRequest<T>) {
    return this.target.generateStructured(req);
  }
}

describe('Ticket classification (integration)', () => {
  const prisma = new PrismaClient();
  const llm = new SwitchableLlm();
  let app: INestApplication;
  let alice: User;
  let customer: Customer;

  const http = () => request(app.getHttpServer());
  const as = (user: User) => ({ 'X-User-Id': user.id });

  const createTicket = async (subject: string, body: string) =>
    (
      await http()
        .post('/api/v1/tickets')
        .send({ customerId: customer.id, subject, body })
        .expect(201)
    ).body as {
      id: string;
      version: number;
      priority: string;
      prioritySource: string;
      intent: string | null;
    };

  const eventTypes = async (ticketId: string) =>
    (await http().get(`/api/v1/tickets/${ticketId}/events`).expect(200)).body.map(
      (e: { type: string; actorType: string }) => `${e.type}:${e.actorType}`,
    );

  beforeAll(async () => {
    app = await createTestApp({ llm });
  });

  beforeEach(async () => {
    llm.target = new MockLlmProvider();
    await resetDb(prisma);
    alice = await createAgent(prisma, { name: 'Alice Agent' });
    customer = await createCustomer(prisma, { tier: 'PREMIUM' });
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
    await prisma.$disconnect();
  });

  describe('auto-classification on create', () => {
    it('classifies after the ticket commits and applies intent and priority as the AI actor', async () => {
      const t = await createTicket(
        'Cannot log in after password reset',
        'I reset my password and now I cannot log in at all.',
      );

      expect(t).toMatchObject({
        intent: 'ACCOUNT_ACCESS',
        priority: 'HIGH',
        prioritySource: 'AI',
        version: 2,
      });
      expect(await eventTypes(t.id)).toEqual([
        'CREATED:SYSTEM',
        'AI_CLASSIFIED:AI',
        'PRIORITY_CHANGED:AI',
        'INTENT_CHANGED:AI',
      ]);

      const runs = (await http().get(`/api/v1/tickets/${t.id}/classifications`).expect(200)).body;
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        ticketId: t.id,
        intent: 'ACCOUNT_ACCESS',
        priority: 'HIGH',
        outcome: 'VALID',
        provider: 'mock',
        model: 'mock-keyword-rules-v1',
        promptVersion: 'classify@v1',
        errorMessage: null,
        language: 'en',
      });
      expect(runs[0].latencyMs).toBeGreaterThanOrEqual(0);
      expect(runs[0].rawOutput).toMatchObject({ intent: 'ACCOUNT_ACCESS' });
    });

    it('keeps the ticket valid with DEFAULT priority when the provider is down', async () => {
      llm.target = new UnavailableLlmProvider();
      const t = await createTicket(
        'Dashboard is down',
        'Every page returns a 500 error for everyone.',
      );

      expect(t).toMatchObject({
        priority: 'MEDIUM',
        prioritySource: 'DEFAULT',
        intent: null,
        version: 1,
      });
      expect(await eventTypes(t.id)).toEqual(['CREATED:SYSTEM']);
      const [run] = (await http().get(`/api/v1/tickets/${t.id}/classifications`).expect(200)).body;
      expect(run).toMatchObject({ outcome: 'FAILED', provider: 'unavailable', rawOutput: null });
      expect(run.errorMessage).toContain('HTTP 401');
    });

    it('handles the seeded prompt-injection ticket with schema-valid output and no obedience', async () => {
      const seed = TICKETS.find((x) => x.id === PROMPT_INJECTION_TICKET_ID)!;
      const t = await createTicket(seed.subject, seed.body);

      const [run] = (await http().get(`/api/v1/tickets/${t.id}/classifications`).expect(200)).body;
      expect(run.outcome).toBe('VALID');
      expect(
        TicketClassificationSchema.safeParse({ ...run, escalationSignals: run.signals }).success,
      ).toBe(true);
      expect(t.priority).not.toBe('LOW');
    });
  });

  describe('POST /tickets/:id/classify', () => {
    it('re-classifies but never overrides a MANUAL priority or a manually corrected intent', async () => {
      const t = await createTicket(
        'Charged twice',
        'Please refund the duplicate charge on my card.',
      );
      expect(t).toMatchObject({ intent: 'REFUND_REQUEST', priority: 'HIGH' });

      const patched = await http()
        .patch(`/api/v1/tickets/${t.id}`)
        .set(as(alice))
        .send({ version: t.version, priority: 'LOW', intent: 'BILLING' })
        .expect(200);

      const res = await http().post(`/api/v1/tickets/${t.id}/classify`).set(as(alice)).expect(200);

      expect(res.body.classification).toMatchObject({ outcome: 'VALID', intent: 'REFUND_REQUEST' });
      expect(res.body.ticket).toMatchObject({
        priority: 'LOW',
        prioritySource: 'MANUAL',
        intent: 'BILLING',
        version: patched.body.version, // nothing applied, so no version bump
      });

      const events = (await http().get(`/api/v1/tickets/${t.id}/events`).expect(200)).body;
      const last = events[events.length - 1];
      expect(last).toMatchObject({ type: 'AI_CLASSIFIED', actorType: 'AI' });
      expect(last.metadata).toMatchObject({
        classificationId: res.body.classification.id,
        requestedBy: alice.id,
        kept: ['priority (set manually)', 'intent (set manually)'],
      });
      expect((await http().get(`/api/v1/tickets/${t.id}/classifications`)).body).toHaveLength(2);
    });

    it('returns 503 Problem Details when the provider fails, records the run, and leaves the ticket unchanged', async () => {
      const t = await createTicket(
        'Invoice address',
        'Please reissue my invoice with the new address.',
      );
      const before = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      const eventsBefore = await eventTypes(t.id);

      llm.target = new UnavailableLlmProvider();
      const res = await http().post(`/api/v1/tickets/${t.id}/classify`).expect(503);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({
        status: 503,
        errorCode: 'AI_PROVIDER_UNAVAILABLE',
        instance: `/api/v1/tickets/${t.id}/classify`,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/HTTP 401|provider unavailable \(test\)/);
      expect(await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).toEqual(before);
      expect(await eventTypes(t.id)).toEqual(eventsBefore);
      const runs = (await http().get(`/api/v1/tickets/${t.id}/classifications`)).body;
      expect(runs.map((r: { outcome: string }) => r.outcome)).toEqual(['FAILED', 'VALID']);
    });

    it('stores a REPAIRED run with the raw output and summed token usage', async () => {
      llm.target = new UnavailableLlmProvider();
      const t = await createTicket('Feature idea', 'Would love a dark mode please.');

      llm.target = new ScriptedLlmProvider(
        { raw: { intent: 'DARK_MODE' } },
        {
          raw: {
            intent: 'FEATURE_REQUEST',
            priority: 'LOW',
            confidence: 0.85,
            reasoning: 'Asks for dark mode.',
            sentiment: 'POSITIVE',
            escalationSignals: [],
            language: 'en',
          },
        },
      );
      const res = await http().post(`/api/v1/tickets/${t.id}/classify`).expect(200);

      expect(res.body.classification).toMatchObject({
        outcome: 'REPAIRED',
        provider: 'scripted',
        inputTokens: 200,
        outputTokens: 40,
        rawOutput: { intent: 'FEATURE_REQUEST' },
      });
      expect(res.body.ticket).toMatchObject({
        intent: 'FEATURE_REQUEST',
        priority: 'LOW',
        prioritySource: 'AI',
      });
    });

    it('records a FALLBACK run without applying it to the ticket', async () => {
      llm.target = new UnavailableLlmProvider();
      const t = await createTicket('Refund please', 'I want a refund for last month.');

      llm.target = new ScriptedLlmProvider({ raw: 'not json' }, { raw: { still: 'wrong' } });
      const res = await http().post(`/api/v1/tickets/${t.id}/classify`).expect(200);

      expect(res.body.classification).toMatchObject({
        outcome: 'FALLBACK',
        intent: 'REFUND_REQUEST',
        confidence: 0.3,
      });
      expect(res.body.classification.errorMessage).toMatch(/Invalid output after repair/);
      expect(res.body.ticket).toMatchObject({
        prioritySource: 'DEFAULT',
        intent: null,
        version: 1,
      });
      // Not applied to the ticket, but an unusable model output sends the ticket to a human.
      expect(await eventTypes(t.id)).toEqual([
        'CREATED:SYSTEM',
        'AI_CLASSIFIED:AI',
        'ESCALATION_RECOMMENDED:SYSTEM',
      ]);
    });

    it('returns 404 for unknown tickets and 409 for closed ones', async () => {
      await http().post(`/api/v1/tickets/${randomUUID()}/classify`).expect(404);
      await http().get(`/api/v1/tickets/${randomUUID()}/classifications`).expect(404);
      await http().post('/api/v1/tickets/not-a-uuid/classify').expect(400);

      const t = await createTicket('Question', 'How do I export my data?');
      const resolved = await http()
        .post(`/api/v1/tickets/${t.id}/status`)
        .set(as(alice))
        .send({ version: t.version, status: 'RESOLVED' })
        .expect(200);
      await http()
        .post(`/api/v1/tickets/${t.id}/status`)
        .set(as(alice))
        .send({ version: resolved.body.version, status: 'CLOSED' })
        .expect(200);

      const res = await http().post(`/api/v1/tickets/${t.id}/classify`).expect(409);
      expect(res.body.errorCode).toBe('TICKET_CLOSED');
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { Customer, PrismaClient, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  PROMPT_INJECTION_TICKET_ID,
  TICKETS,
  VIP_LAWYER_TICKET_ID,
} from '../../../../prisma/seed-data';
import { seedKnowledgeBase } from '../../../../prisma/seed';
import { createAgent, createCustomer, createTestApp, resetDb } from '../../../../test/helpers';
import {
  SwitchableLlmProvider,
  UnavailableLlmProvider,
} from '../../../../test/scripted-llm.provider';
import { HashEmbeddingProvider } from '../../ai/providers/hash-embedding.provider';
import { MockLlmProvider } from '../../ai/providers/mock-llm.provider';

interface TicketBody {
  id: string;
  version: number;
  status: string;
  priority: string;
}
interface EscalationBody {
  id: string;
  recommended: boolean;
  level: string;
  triggeredRules: string[];
  reasons: { rule: string; level: string; detail: string; source: string }[];
  decision: string;
}

describe('Escalation (integration)', () => {
  const prisma = new PrismaClient();
  const llm = new SwitchableLlmProvider(new MockLlmProvider());
  let app: INestApplication;
  let alice: User;
  let vip: Customer;
  let standard: Customer;

  const http = () => request(app.getHttpServer());
  const as = (user: User) => ({ 'X-User-Id': user.id });

  const createTicket = async (customer: Customer, subject: string, body: string) =>
    (
      await http()
        .post('/api/v1/tickets')
        .set(as(alice))
        .send({ customerId: customer.id, subject, body })
        .expect(201)
    ).body as TicketBody;
  const seedTicket = (id: string) => TICKETS.find((t) => t.id === id)!;
  const lawyerTicket = () => {
    const s = seedTicket(VIP_LAWYER_TICKET_ID);
    return createTicket(vip, s.subject, s.body);
  };
  const calmTicket = () =>
    createTicket(standard, 'Invoice copy', 'Could you send me a copy of the September invoice?');
  const escalations = async (ticketId: string) =>
    (await http().get(`/api/v1/tickets/${ticketId}/escalations`).set(as(alice)).expect(200))
      .body as EscalationBody[];
  const evaluate = (ticketId: string) =>
    http().post(`/api/v1/tickets/${ticketId}/escalation/evaluate`).set(as(alice));
  const decide = (escalationId: string, body: object) =>
    http().post(`/api/v1/escalations/${escalationId}/decision`).set(as(alice)).send(body);
  const eventTypes = async (ticketId: string) =>
    (await http().get(`/api/v1/tickets/${ticketId}/events`).set(as(alice)).expect(200)).body.map(
      (e: { type: string; actorType: string }) => `${e.type}:${e.actorType}`,
    );

  beforeAll(async () => {
    app = await createTestApp({ llm });
  });

  beforeEach(async () => {
    llm.target = new MockLlmProvider();
    await resetDb(prisma);
    alice = await createAgent(prisma, { name: 'Alice Agent' });
    vip = await createCustomer(prisma, { tier: 'VIP' });
    standard = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
    await prisma.$disconnect();
  });

  describe('automatic evaluation', () => {
    it('recommends a MANAGER escalation for the angry VIP lawyer ticket right after classification', async () => {
      const t = await lawyerTicket();

      const [rec] = await escalations(t.id);
      expect(rec).toMatchObject({
        recommended: true,
        level: 'MANAGER',
        decision: 'PENDING',
        triggeredRules: ['URGENT_PRIORITY', 'LEGAL_SECURITY', 'VIP_CUSTOMER', 'ANGRY_REPEAT'],
      });
      expect(rec.reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ rule: 'LEGAL_SECURITY', level: 'MANAGER', source: 'RULE' }),
          expect.objectContaining({ rule: 'ANGRY_REPEAT', level: 'MANAGER', source: 'LLM' }),
        ]),
      );
      expect(await eventTypes(t.id)).toEqual([
        'CREATED:USER',
        'AI_CLASSIFIED:AI',
        'PRIORITY_CHANGED:AI',
        'INTENT_CHANGED:AI',
        'ESCALATION_RECOMMENDED:SYSTEM',
      ]);
      // Recommending does not touch the ticket: no status change, no extra version bump.
      const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect(ticket).toMatchObject({ status: 'OPEN', version: t.version });
    });

    it('stores a NONE evaluation for a calm ticket, without a timeline event', async () => {
      const t = await calmTicket();

      expect(await escalations(t.id)).toEqual([
        expect.objectContaining({ recommended: false, level: 'NONE', triggeredRules: [] }),
      ]);
      expect(await eventTypes(t.id)).not.toContain('ESCALATION_RECOMMENDED:SYSTEM');
    });

    it('sends the prompt-injection ticket to a human (LOW_CONFIDENCE) without obeying it', async () => {
      const s = seedTicket(PROMPT_INJECTION_TICKET_ID);
      const t = await createTicket(standard, s.subject, s.body);

      expect(t.priority).not.toBe('LOW');
      const [rec] = await escalations(t.id);
      expect(rec).toMatchObject({ recommended: true, level: 'TIER2' });
      expect(rec.triggeredRules).toContain('LOW_CONFIDENCE');
    });

    it('re-evaluates after drafting: a KB gap on technical issues escalates, while off-topic gaps do not', async () => {
      await seedKnowledgeBase(prisma, new HashEmbeddingProvider());

      // 1. Off-topic question: KB gap is normal and must NOT trigger KB_GAP escalation
      const offTopic = await createTicket(
        standard,
        'Weather in Paris',
        'Will it rain in Paris this weekend? Any restaurant tips near the Louvre?',
      );
      const offTopicDraft = (await http().post(`/api/v1/tickets/${offTopic.id}/drafts`).expect(201))
        .body;
      expect(offTopicDraft.answerable).toBe(false);
      const [offTopicRec] = await escalations(offTopic.id);
      expect(offTopicRec.triggeredRules).not.toContain('KB_GAP');

      // 2. Technical issue without KB article: KB gap DOES trigger KB_GAP Tier 2 escalation
      const t = await createTicket(
        standard,
        'Outage on webhook endpoint 502',
        'Every webhook delivery returns 502 and crashes our custom server. Is there an outage?',
      );
      const [before] = await escalations(t.id);
      expect(before.triggeredRules).not.toContain('KB_GAP');

      const draft = (await http().post(`/api/v1/tickets/${t.id}/drafts`).expect(201)).body;
      expect(draft.answerable).toBe(false);

      const [latest, previous] = await escalations(t.id);
      expect(previous.id).toBe(before.id);
      expect(latest).toMatchObject({ recommended: true, level: 'TIER2' });
      expect(latest.triggeredRules).toContain('KB_GAP');

      if (previous.recommended) {
        const res = await decide(previous.id, { decision: 'DISMISSED' }).expect(409);
        expect(res.body.errorCode).toBe('ESCALATION_SUPERSEDED');
      }
    });
  });

  describe('POST /tickets/:id/escalation/evaluate', () => {
    it('returns the latest recommendation and does not duplicate unchanged findings', async () => {
      const t = await lawyerTicket();
      const [auto] = await escalations(t.id);

      const res = await evaluate(t.id).expect(200);

      expect(res.body.id).toBe(auto.id);
      expect(await escalations(t.id)).toHaveLength(1);
    });

    it('returns 404 for an unknown ticket and 409 when the ticket cannot be escalated', async () => {
      await evaluate(randomUUID()).expect(404);

      const t = await calmTicket();
      await http()
        .post(`/api/v1/tickets/${t.id}/status`)
        .set(as(alice))
        .send({ status: 'RESOLVED', version: t.version })
        .expect(200);
      const res = await evaluate(t.id).expect(409);
      expect(res.body.errorCode).toBe('ESCALATION_NOT_APPLICABLE');
    });
  });

  describe('POST /escalations/:id/decision', () => {
    it('accepts: moves the ticket to ESCALATED with both audit events in one transaction', async () => {
      const t = await lawyerTicket();
      const [rec] = await escalations(t.id);

      const res = await decide(rec.id, {
        decision: 'ACCEPTED',
        version: t.version,
        note: 'Calling the customer now',
      }).expect(200);

      expect(res.body.ticket).toEqual({ id: t.id, status: 'ESCALATED', version: t.version + 1 });
      expect(res.body.escalation).toMatchObject({
        id: rec.id,
        decision: 'ACCEPTED',
        decidedBy: { id: alice.id, name: 'Alice Agent' },
      });
      const events = (await http().get(`/api/v1/tickets/${t.id}/events`)).body.slice(-2);
      expect(events).toEqual([
        expect.objectContaining({
          type: 'ESCALATION_ACCEPTED',
          actorType: 'USER',
          actorId: alice.id,
          toValue: 'ACCEPTED',
          metadata: expect.objectContaining({
            escalationId: rec.id,
            note: 'Calling the customer now',
          }),
        }),
        expect.objectContaining({
          type: 'STATUS_CHANGED',
          actorType: 'USER',
          fromValue: 'OPEN',
          toValue: 'ESCALATED',
        }),
      ]);

      const again = await decide(rec.id, { decision: 'DISMISSED' }).expect(409);
      expect(again.body.errorCode).toBe('ESCALATION_ALREADY_DECIDED');
    });

    it('prevents simultaneous conflicting decisions from both committing', async () => {
      const t = await lawyerTicket();
      const [rec] = await escalations(t.id);
      const results = await Promise.all([
        decide(rec.id, { decision: 'ACCEPTED', version: t.version }),
        decide(rec.id, { decision: 'DISMISSED', version: t.version }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);
      expect(results.filter((r) => r.status === 409)[0].body.errorCode).toMatch(
        /ALREADY_DECIDED|VERSION_CONFLICT/,
      );
      const saved = await prisma.escalationRecommendation.findUniqueOrThrow({
        where: { id: rec.id },
      });
      expect(saved.decision).not.toBe('PENDING');
      const decisionEvents = await prisma.ticketEvent.count({
        where: { ticketId: t.id, type: { in: ['ESCALATION_ACCEPTED', 'ESCALATION_DISMISSED'] } },
      });
      expect(decisionEvents).toBe(1);
    });

    it('rolls the decision back when the ticket version is stale', async () => {
      const t = await lawyerTicket();
      const [rec] = await escalations(t.id);
      await http()
        .post(`/api/v1/tickets/${t.id}/assign`)
        .set(as(alice))
        .send({ assigneeId: alice.id, version: t.version })
        .expect(200);

      const res = await decide(rec.id, { decision: 'ACCEPTED', version: t.version }).expect(409);

      expect(res.body.errorCode).toBe('TICKET_VERSION_CONFLICT');
      const [after] = await escalations(t.id);
      expect(after.decision).toBe('PENDING');
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('OPEN');
    });

    it('dismisses without changing the ticket, and does not raise the same findings again', async () => {
      const t = await lawyerTicket();
      const [rec] = await escalations(t.id);
      const before = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });

      const res = await decide(rec.id, { decision: 'DISMISSED', note: 'Handled by phone' }).expect(
        200,
      );

      expect(res.body.escalation.decision).toBe('DISMISSED');
      expect(res.body.ticket).toEqual({ id: t.id, status: 'OPEN', version: t.version });
      expect(await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).toEqual(before);
      expect((await eventTypes(t.id)).at(-1)).toBe('ESCALATION_DISMISSED:USER');

      const reevaluated = await evaluate(t.id).expect(200);
      expect(reevaluated.body).toMatchObject({ id: rec.id, decision: 'DISMISSED' });
      expect(await escalations(t.id)).toHaveLength(1);
    });

    it('validates the request and refuses evaluations where nothing fired', async () => {
      const t = await lawyerTicket();
      const [rec] = await escalations(t.id);

      const noVersion = await decide(rec.id, { decision: 'ACCEPTED' }).expect(400);
      expect(noVersion.body.errors.map((e: { field: string }) => e.field)).toContain('version');
      await decide(rec.id, { decision: 'MAYBE' }).expect(400);
      await http()
        .post(`/api/v1/escalations/${rec.id}/decision`)
        .send({ decision: 'DISMISSED' })
        .expect(400); // X-User-Id is required
      await decide(randomUUID(), { decision: 'DISMISSED' }).expect(404);

      const calm = await calmTicket();
      const [none] = await escalations(calm.id);
      const res = await decide(none.id, { decision: 'DISMISSED' }).expect(409);
      expect(res.body.errorCode).toBe('ESCALATION_NOT_RECOMMENDED');
    });
  });

  describe('provider down', () => {
    it('explicit classify returns 503, leaves the ticket unchanged and does not evaluate escalation', async () => {
      const t = await calmTicket();
      const ticketBefore = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      const escalationsBefore = await escalations(t.id);
      const eventsBefore = await eventTypes(t.id);

      llm.target = new UnavailableLlmProvider();
      const res = await http().post(`/api/v1/tickets/${t.id}/classify`).set(as(alice)).expect(503);

      expect(res.body).toMatchObject({ status: 503, errorCode: 'AI_PROVIDER_UNAVAILABLE' });
      expect(await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).toEqual(ticketBefore);
      expect(await escalations(t.id)).toEqual(escalationsBefore);
      expect(await eventTypes(t.id)).toEqual(eventsBefore);
    });

    it('on create, the keyword floor still escalates a legal threat when the provider is down', async () => {
      llm.target = new UnavailableLlmProvider();
      const t = await lawyerTicket();

      expect(t).toMatchObject({ status: 'OPEN', priority: 'MEDIUM' });
      const [rec] = await escalations(t.id);
      // Only rules that do not depend on the model fire: no LOW_CONFIDENCE for a FAILED run.
      expect(rec).toMatchObject({
        recommended: true,
        level: 'MANAGER',
        triggeredRules: ['LEGAL_SECURITY'],
      });
      expect(rec.reasons.every((r) => r.source === 'RULE')).toBe(true);
    });
  });
});

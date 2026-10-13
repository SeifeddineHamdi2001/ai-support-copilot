import { INestApplication } from '@nestjs/common';
import { Customer, PrismaClient, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedKnowledgeBase } from '../../../../prisma/seed';
import { createAgent, createCustomer, createTestApp, resetDb } from '../../../../test/helpers';
import {
  ScriptedLlmProvider,
  UnavailableLlmProvider,
} from '../../../../test/scripted-llm.provider';
import { HashEmbeddingProvider } from '../../ai/providers/hash-embedding.provider';
import type { LlmProvider, StructuredRequest } from '../../ai/providers/llm-provider';
import { MockLlmProvider } from '../../ai/providers/mock-llm.provider';
import { HOLDING_REPLY, stripCitationMarkers } from '../citations';

/** Delegates to a provider chosen per test and counts draft requests. */
class SpyLlm implements LlmProvider {
  target: LlmProvider = new MockLlmProvider();
  draftCalls = 0;
  get name() {
    return this.target.name;
  }
  get model() {
    return this.target.model;
  }
  generateStructured<T>(req: StructuredRequest<T>) {
    if (req.schemaName === 'DraftResponse') this.draftCalls++;
    return this.target.generateStructured(req);
  }
}

interface Draft {
  id: string;
  ticketId: string;
  content: string;
  answerable: boolean;
  confidence: number;
  missingInformation: string[];
  status: string;
  provider: string;
  model: string;
  promptVersion: string;
  outcome: string;
  citations: {
    label: string;
    rank: number;
    score: number;
    quote: string | null;
    chunkId: string | null;
    documentId: string;
    document: { title: string; slug: string };
    chunk: { headingPath: string; content: string } | null;
  }[];
}

describe('Drafts (integration)', () => {
  const prisma = new PrismaClient();
  const llm = new SpyLlm();
  let app: INestApplication;
  let alice: User;
  let customer: Customer;

  const http = () => request(app.getHttpServer());
  const as = (user: User) => ({ 'X-User-Id': user.id });

  const createTicket = async (subject: string, body: string) => {
    const t = (
      await http()
        .post('/api/v1/tickets')
        .send({ customerId: customer.id, subject, body })
        .expect(201)
    ).body as { id: string; version: number };
    llm.draftCalls = 0;
    return t;
  };
  const refundTicket = () =>
    createTicket(
      'Charged twice for my Pro subscription',
      'I was charged $29 twice on October 3rd for the same Pro monthly plan. Please refund the duplicate charge.',
    );
  const generate = async (ticketId: string, status = 201) =>
    (await http().post(`/api/v1/tickets/${ticketId}/drafts`).set(as(alice)).expect(status)).body;

  beforeAll(async () => {
    app = await createTestApp({ llm });
  });

  beforeEach(async () => {
    llm.target = new MockLlmProvider();
    await resetDb(prisma);
    await seedKnowledgeBase(prisma, new HashEmbeddingProvider());
    alice = await createAgent(prisma, { name: 'Alice Agent' });
    customer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
    await prisma.$disconnect();
  });

  describe('POST /tickets/:id/drafts', () => {
    it('answers a refund question from the refund policy with citations to real chunks', async () => {
      const ticket = await refundTicket();

      const draft = (await generate(ticket.id)) as Draft;

      expect(draft).toMatchObject({
        ticketId: ticket.id,
        answerable: true,
        status: 'DRAFT',
        outcome: 'VALID',
        provider: 'mock',
        promptVersion: 'draft@v1',
      });
      expect(llm.draftCalls).toBe(1);
      expect(draft.content).toMatch(/\[S\d\]/);
      expect(draft.content).toContain('5–7 business days');
      expect(draft.citations.length).toBeGreaterThan(0);
      expect(draft.citations[0].document.slug).toBe('refund-policy');
      for (const c of draft.citations) {
        expect(c.label).toBe(`S${c.rank}`);
        expect(draft.content).toContain(`[${c.label}]`);
        expect(c.score).toBeGreaterThanOrEqual(0.15);
        expect(c.quote).not.toBeNull();
        expect(c.chunk!.content.replace(/\s+/g, ' ')).toContain(c.quote!.replace(/\s+/g, ' '));
      }

      // Citation rows join to existing chunks and documents.
      const rows = await prisma.draftCitation.findMany({
        where: { draftId: draft.id },
        include: { chunk: true, document: true },
      });
      expect(rows).toHaveLength(draft.citations.length);
      for (const r of rows) expect(r.chunk?.documentId).toBe(r.document.id);

      const events = await prisma.ticketEvent.findMany({
        where: { ticketId: ticket.id, type: 'DRAFT_GENERATED' },
      });
      expect(events).toEqual([
        expect.objectContaining({
          actorType: 'AI',
          toValue: 'ANSWERABLE',
          metadata: expect.objectContaining({ draftId: draft.id, requestedBy: alice.id }),
        }),
      ]);
      // The ticket row is untouched, so open editors do not get a version conflict.
      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(after.version).toBe(ticket.version);
    });

    it('gives an off-topic ticket the holding reply without calling the LLM', async () => {
      const ticket = await createTicket(
        'What is the weather in Paris this weekend?',
        'Hi! Planning a trip to Paris this weekend, do you know if it will rain? Also any good restaurant tips near the Louvre?',
      );

      const draft = (await generate(ticket.id)) as Draft;

      expect(llm.draftCalls).toBe(0);
      expect(draft).toMatchObject({
        answerable: false,
        content: HOLDING_REPLY,
        citations: [],
        outcome: 'VALID',
        provider: 'system',
        model: 'retrieval-gate',
        confidence: 0,
      });
      expect(draft.missingInformation.length).toBeGreaterThan(0);
      const event = await prisma.ticketEvent.findFirstOrThrow({
        where: { ticketId: ticket.id, type: 'DRAFT_GENERATED' },
      });
      expect(event).toMatchObject({
        toValue: 'NOT_ANSWERABLE',
        metadata: expect.objectContaining({ holdingReason: 'NO_SOURCES_ABOVE_FLOOR' }),
      });
    });

    it('falls back to the holding reply when the model keeps citing chunks it was not given', async () => {
      const ticket = await refundTicket();
      const invented = {
        answerable: true,
        answer: 'You will get a full refund within 24 hours [S1].',
        citations: [{ chunkId: randomUUID(), quote: 'full refund within 24 hours' }],
        confidence: 0.9,
        missingInformation: [],
      };
      const scripted = new ScriptedLlmProvider({ raw: invented }, { raw: invented });
      llm.target = scripted;

      const draft = (await generate(ticket.id)) as Draft;

      expect(scripted.calls).toBe(2);
      expect(scripted.requests[1].prompt).toContain('is not the chunk_id of any provided source');
      expect(draft).toMatchObject({
        outcome: 'FALLBACK',
        answerable: false,
        content: HOLDING_REPLY,
        citations: [],
      });
      expect(await prisma.draftCitation.count()).toBe(0);
    });

    it('returns 503 when the provider is down, records the run and leaves the ticket unchanged', async () => {
      const ticket = await refundTicket();
      llm.target = new UnavailableLlmProvider();

      const res = await generate(ticket.id, 503);

      expect(res.errorCode).toBe('AI_PROVIDER_UNAVAILABLE');
      const drafts = await prisma.aiDraftResponse.findMany({ where: { ticketId: ticket.id } });
      expect(drafts).toEqual([
        expect.objectContaining({ outcome: 'FAILED', answerable: false, content: HOLDING_REPLY }),
      ]);
      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(after.version).toBe(ticket.version);
    });

    it('returns 404 for an unknown ticket', async () => {
      await http().post(`/api/v1/tickets/${randomUUID()}/drafts`).expect(404);
    });

    it('lists drafts newest first', async () => {
      const ticket = await refundTicket();
      const first = (await generate(ticket.id)) as Draft;
      const second = (await generate(ticket.id)) as Draft;

      const list = (await http().get(`/api/v1/tickets/${ticket.id}/drafts`).expect(200))
        .body as Draft[];

      expect(list.map((d) => d.id)).toEqual([second.id, first.id]);
      expect(list[0].citations.length).toBeGreaterThan(0);
    });
  });

  describe('PATCH /drafts/:id', () => {
    it('approves an edited draft once, creating the agent message and an audit event', async () => {
      const ticket = await refundTicket();
      const draft = (await generate(ticket.id)) as Draft;
      const edited = `${draft.content}\n\nP.S. The duplicate charge is already confirmed.`;

      const approved = (
        await http()
          .patch(`/api/v1/drafts/${draft.id}`)
          .set(as(alice))
          .send({ status: 'APPROVED', content: edited })
          .expect(200)
      ).body;

      expect(approved).toMatchObject({
        status: 'APPROVED',
        content: edited,
        reviewedBy: { id: alice.id, name: 'Alice Agent' },
      });
      const messages = await prisma.ticketMessage.findMany({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(messages.map((m) => [m.authorType, m.authorId])).toEqual([
        ['CUSTOMER', customer.id],
        ['AGENT', alice.id],
      ]);
      // The draft keeps its [S#] markers for review; the customer's copy has none.
      expect(edited).toMatch(/\[S\d+\]/);
      expect(messages[1].body).toBe(stripCitationMarkers(edited));
      expect(messages[1].body).not.toMatch(/\[S\d+\]/);
      const event = await prisma.ticketEvent.findFirstOrThrow({
        where: { ticketId: ticket.id, type: 'DRAFT_APPROVED' },
      });
      expect(event).toMatchObject({
        actorType: 'USER',
        actorId: alice.id,
        metadata: { draftId: draft.id, messageId: messages[1].id, edited: true },
      });

      const again = await http()
        .patch(`/api/v1/drafts/${draft.id}`)
        .set(as(alice))
        .send({ status: 'APPROVED' })
        .expect(409);
      expect(again.body.errorCode).toBe('DRAFT_ALREADY_REVIEWED');
      expect(await prisma.ticketMessage.count({ where: { ticketId: ticket.id } })).toBe(2);
    });

    it('rejects a draft without creating a message', async () => {
      const ticket = await refundTicket();
      const draft = (await generate(ticket.id)) as Draft;

      await http()
        .patch(`/api/v1/drafts/${draft.id}`)
        .set(as(alice))
        .send({ status: 'REJECTED' })
        .expect(200)
        .expect((r) => expect(r.body.status).toBe('REJECTED'));

      expect(await prisma.ticketMessage.count({ where: { ticketId: ticket.id } })).toBe(1);
      expect(
        await prisma.ticketEvent.count({ where: { ticketId: ticket.id, type: 'DRAFT_REJECTED' } }),
      ).toBe(1);
    });

    it('validates the request', async () => {
      const ticket = await refundTicket();
      const draft = (await generate(ticket.id)) as Draft;
      const url = `/api/v1/drafts/${draft.id}`;

      await http().patch(url).send({ status: 'APPROVED' }).expect(400); // no X-User-Id
      await http().patch(url).set(as(alice)).send({ status: 'SENT' }).expect(400);
      await http()
        .patch(url)
        .set(as(alice))
        .send({ status: 'REJECTED', content: 'text' })
        .expect(400);
      await http()
        .patch(`/api/v1/drafts/${randomUUID()}`)
        .set(as(alice))
        .send({ status: 'APPROVED' })
        .expect(404);
      const unchanged = await prisma.aiDraftResponse.findUniqueOrThrow({ where: { id: draft.id } });
      expect(unchanged.status).toBe('DRAFT');
    });
  });

  describe('when the cited knowledge base changes', () => {
    const listDrafts = async (ticketId: string) =>
      (await http().get(`/api/v1/tickets/${ticketId}/drafts`).expect(200)).body as Draft[];

    it('keeps the citation (document + quote) when the source document is edited', async () => {
      const ticket = await refundTicket();
      const draft = (await generate(ticket.id)) as Draft;
      const cited = draft.citations.find((c) => c.document.slug === 'refund-policy')!;
      const doc = await prisma.kbDocument.findUniqueOrThrow({ where: { slug: 'refund-policy' } });

      // Changing the content replaces every chunk of the document.
      await http()
        .post('/api/v1/kb/documents')
        .set(as(alice))
        .send({
          title: doc.title,
          slug: doc.slug,
          category: doc.category,
          content: '# Refunds\n\nRefunds now take 3 business days.',
        })
        .expect(201)
        .expect((r) => expect(r.body.status).toBe('updated'));

      const [after] = await listDrafts(ticket.id);
      expect(after.citations).toHaveLength(draft.citations.length);
      const kept = after.citations.find((c) => c.label === cited.label)!;
      expect(kept).toMatchObject({
        chunkId: null,
        chunk: null,
        documentId: doc.id,
        quote: cited.quote,
        document: { slug: 'refund-policy' },
      });
    });

    it('drops the citations of a deleted document but keeps the draft readable', async () => {
      const ticket = await refundTicket();
      const draft = (await generate(ticket.id)) as Draft;
      const doc = await prisma.kbDocument.findUniqueOrThrow({ where: { slug: 'refund-policy' } });

      await http().delete(`/api/v1/kb/documents/${doc.id}`).set(as(alice)).expect(204);

      const [after] = await listDrafts(ticket.id);
      expect(after).toMatchObject({ id: draft.id, content: draft.content, status: 'DRAFT' });
      expect(after.citations.every((c) => c.documentId !== doc.id)).toBe(true);
      expect(after.citations).toHaveLength(
        draft.citations.filter((c) => c.documentId !== doc.id).length,
      );
    });
  });
});

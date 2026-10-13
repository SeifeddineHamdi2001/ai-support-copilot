import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { seedKnowledgeBase } from '../../../../prisma/seed';
import { createAgent, createTestApp, resetDb } from '../../../../test/helpers';
import type { User } from '@prisma/client';
import { HashEmbeddingProvider } from '../../ai/providers/hash-embedding.provider';
import type { EmbeddingProvider } from '../../ai/providers/llm-provider';
import { KbIngestor } from '../kb-ingestor';

class FailingEmbedder implements EmbeddingProvider {
  readonly name = 'mock';
  readonly model = 'hash-768-v1';
  readonly dimensions = 768 as const;
  embedDocuments(): Promise<number[][]> {
    return Promise.reject(new Error('embedding service down (test)'));
  }
  embedQuery(): Promise<number[]> {
    return Promise.reject(new Error('embedding service down (test)'));
  }
}

interface Hit {
  id: string;
  slug: string;
  headingPath: string;
  similarity: number;
  rrf: number;
  semanticRank: number | null;
  lexicalRank: number | null;
}

describe('Knowledge base (integration)', () => {
  const prisma = new PrismaClient();
  const embedder = new HashEmbeddingProvider();
  let app: INestApplication;
  let agent: User;

  const http = () => request(app.getHttpServer());
  const search = async (query: string) =>
    (
      await http()
        .post('/api/v1/kb/search')
        .set({ 'X-User-Id': agent.id })
        .send({ query })
        .expect(200)
    ).body as {
      results: Hit[];
      belowFloor: Hit[];
      minSimilarity: number;
      topK: number;
      embeddingModel: string;
      staleChunks: number;
    };

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    agent = await createAgent(prisma);
    await seedKnowledgeBase(prisma, embedder);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
    await prisma.$disconnect();
  });

  describe('ingestion', () => {
    it('indexes the 10 seed documents with an embedding and model on every chunk', async () => {
      expect(await prisma.kbDocument.count({ where: { status: 'INDEXED' } })).toBe(10);
      const [row] = await prisma.$queryRaw<{ total: number; embedded: number }[]>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE embedding IS NOT NULL AND "embeddingModel" = 'hash-768-v1')::int AS embedded
        FROM "KbChunk"`;
      expect(row.total).toBeGreaterThanOrEqual(30);
      expect(row.embedded).toBe(row.total);

      const refund = await prisma.kbChunk.findMany({
        where: { document: { slug: 'refund-policy' } },
        orderBy: { ordinal: 'asc' },
      });
      expect(refund.map((c) => c.headingPath)).toContain('Refund Policy > Annual plans');
    });

    it('is idempotent: unchanged documents are skipped and keep their chunks', async () => {
      const before = await prisma.kbChunk.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
      });

      const second = await seedKnowledgeBase(prisma, embedder);

      expect(second.map((r) => r.status)).toEqual(Array(10).fill('unchanged'));
      const after = await prisma.kbChunk.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
      expect(after).toEqual(before);
    });

    it('replaces the chunks when the content changes', async () => {
      const ingestor = new KbIngestor(prisma, embedder);
      const old = await prisma.kbChunk.findMany({ where: { document: { slug: 'sla' } } });

      const res = await ingestor.ingest({
        title: 'Support SLA and Uptime Commitment',
        slug: 'sla',
        category: 'support',
        body: '# Support SLA\n\n## Response times\n\nVIP customers get a first response within 2 hours.',
      });

      expect(res).toMatchObject({ status: 'updated', chunks: 1 });
      const now = await prisma.kbChunk.findMany({ where: { document: { slug: 'sla' } } });
      expect(now).toHaveLength(1);
      expect(now[0].id).not.toBe(old[0].id);
      expect(now[0].content).toContain('2 hours');
    });

    it('keeps the previous chunks searchable when embedding fails', async () => {
      const before = await prisma.kbChunk.count({ where: { document: { slug: 'sla' } } });

      const res = await new KbIngestor(prisma, new FailingEmbedder()).ingest({
        title: 'Support SLA and Uptime Commitment',
        slug: 'sla',
        category: 'support',
        body: '# New SLA\n\nCompletely new content that cannot be embedded.',
      });

      expect(res.status).toBe('failed');
      const doc = await prisma.kbDocument.findUniqueOrThrow({ where: { slug: 'sla' } });
      expect(doc).toMatchObject({ status: 'FAILED', error: expect.stringContaining('down') });
      expect(await prisma.kbChunk.count({ where: { documentId: doc.id } })).toBe(before);
      expect((await search('VIP first response time')).results[0].slug).toBe('sla');
    });
  });

  describe('POST /kb/search', () => {
    it('finds the refund policy for a refund question, with scores', async () => {
      const res = await search(
        'Refund for annual plan after downgrading. We bought the annual Business plan three weeks ago, can we get a refund for the unused months?',
      );

      expect(res).toMatchObject({ topK: 5, minSimilarity: 0.15, embeddingModel: 'hash-768-v1' });
      expect(res.results.length).toBeGreaterThan(0);
      expect(res.results.slice(0, 3).map((h) => h.slug)).toContain('refund-policy');
      expect(res.results[0]).toMatchObject({
        slug: 'refund-policy',
        headingPath: 'Refund Policy > Annual plans',
      });
      for (const h of res.results) {
        expect(h.similarity).toBeGreaterThanOrEqual(res.minSimilarity);
        expect(h.rrf).toBeGreaterThan(0);
        expect(h.semanticRank ?? h.lexicalRank).not.toBeNull();
      }
      // Sorted by fused score.
      const rrf = res.results.map((h) => h.rrf);
      expect(rrf).toEqual([...rrf].sort((a, b) => b - a));
    });

    it('returns no results for an off-topic question (all below the similarity floor)', async () => {
      const res = await search(
        'What is the weather in Paris this weekend? Will it rain, and any restaurant tips near the Louvre?',
      );
      expect(res.results).toEqual([]);
      for (const h of res.belowFloor) expect(h.similarity).toBeLessThan(res.minSimilarity);
    });

    it('skips chunks embedded with another model until they are reindexed', async () => {
      const doc = await prisma.kbDocument.findUniqueOrThrow({ where: { slug: 'refund-policy' } });
      await prisma.kbChunk.updateMany({
        where: { documentId: doc.id },
        data: { embeddingModel: 'some-other-model' },
      });
      const query = 'duplicate charge refunded to the original payment method';

      const stale = await search(query);
      expect(stale.staleChunks).toBeGreaterThan(0);
      expect(stale.results.map((h) => h.slug)).not.toContain('refund-policy');

      await http()
        .post(`/api/v1/kb/documents/${doc.id}/reindex`)
        .set({ 'X-User-Id': agent.id })
        .expect(200)
        .expect((r) => expect(r.body.status).toBe('reembedded'));
      const fresh = await search(query);
      expect(fresh.staleChunks).toBe(0);
      expect(fresh.results[0].slug).toBe('refund-policy');
    });

    it('validates the query', async () => {
      const res = await http()
        .post('/api/v1/kb/search')
        .set({ 'X-User-Id': agent.id })
        .send({ query: '', k: 50 })
        .expect(400);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
      expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['k', 'query']);
    });
  });

  describe('documents API', () => {
    const doc = {
      title: 'Webhooks',
      category: 'product',
      content:
        '# Webhooks\n\n## Retries\n\nFailed webhook deliveries are retried 5 times with exponential backoff.',
    };

    it('creates, skips unchanged content, lists, reads and deletes a document', async () => {
      const created = await http()
        .post('/api/v1/kb/documents')
        .set({ 'X-User-Id': agent.id })
        .send(doc)
        .expect(201);
      expect(created.body).toMatchObject({
        status: 'created',
        chunks: 1,
        document: { slug: 'webhooks', status: 'INDEXED', chunkCount: 1 },
      });
      const id = created.body.document.id as string;

      await http()
        .post('/api/v1/kb/documents')
        .set({ 'X-User-Id': agent.id })
        .send(doc)
        .expect(201)
        .expect((r) => expect(r.body.status).toBe('unchanged'));

      const list = (await http().get('/api/v1/kb/documents').set({ 'X-User-Id': agent.id }).expect(200)).body;
      expect(list).toHaveLength(11);

      const detail = (await http().get(`/api/v1/kb/documents/${id}`).set({ 'X-User-Id': agent.id }).expect(200)).body;
      expect(detail.chunks).toEqual([
        expect.objectContaining({
          headingPath: 'Webhooks > Retries',
          embeddingModel: 'hash-768-v1',
        }),
      ]);
      expect((await search('webhook retries backoff')).results[0].slug).toBe('webhooks');

      await http().delete(`/api/v1/kb/documents/${id}`).set({ 'X-User-Id': agent.id }).expect(204);
      await http().get(`/api/v1/kb/documents/${id}`).set({ 'X-User-Id': agent.id }).expect(404);
      expect(await prisma.kbChunk.count({ where: { documentId: id } })).toBe(0);
    });

    it('rejects invalid documents', async () => {
      const res = await http()
        .post('/api/v1/kb/documents')
        .set({ 'X-User-Id': agent.id })
        .send({ ...doc, slug: 'Not A Slug', content: 'short' })
        .expect(400);
      expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual([
        'content',
        'slug',
      ]);
    });
  });
});

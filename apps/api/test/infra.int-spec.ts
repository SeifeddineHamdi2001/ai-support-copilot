import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { seed } from '../prisma/seed';
import { TICKETS } from '../prisma/seed-data';

describe('infrastructure (real Postgres + pgvector)', () => {
  const prisma = new PrismaClient();
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('installs the pgvector extension', async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(rows).toHaveLength(1);
  });

  it('creates the HNSW and full-text GIN indexes on KbChunk', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'KbChunk' AND indexname IN ('kb_chunk_embedding_hnsw', 'kb_chunk_fts_gin')
      ORDER BY indexname`;
    expect(rows.map((r) => r.indexname)).toEqual(['kb_chunk_embedding_hnsw', 'kb_chunk_fts_gin']);
    expect(rows[0].indexdef).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
    expect(rows[1].indexdef).toMatch(/USING gin \(to_tsvector\('english'/);
  });

  it('stores a 768-dim vector in KbChunk.embedding', async () => {
    const doc = await prisma.kbDocument.create({
      data: { title: 'Probe', slug: `probe-${Date.now()}`, category: 'test', contentHash: 'x' },
    });
    const chunk = await prisma.kbChunk.create({
      data: {
        documentId: doc.id,
        ordinal: 0,
        headingPath: 'Probe',
        content: 'probe',
        tokenCount: 1,
      },
    });
    const vec = `[${Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;
    await prisma.$executeRaw`UPDATE "KbChunk" SET embedding = ${vec}::vector WHERE id = ${chunk.id}::uuid`;
    const [row] = await prisma.$queryRaw<{ dims: number }[]>`
      SELECT vector_dims(embedding) AS dims FROM "KbChunk" WHERE id = ${chunk.id}::uuid`;
    expect(row.dims).toBe(768);
    await prisma.kbDocument.delete({ where: { id: doc.id } });
  });

  it('GET /api/v1/health reports the database as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      db: 'up',
      providers: { llm: 'mock', embedding: 'mock' },
    });
  });

  it('seed is idempotent', async () => {
    const first = await seed(prisma);
    const counts = async () => ({
      users: await prisma.user.count(),
      customers: await prisma.customer.count(),
      tickets: await prisma.ticket.count(),
      messages: await prisma.ticketMessage.count(),
      events: await prisma.ticketEvent.count(),
      assignments: await prisma.ticketAssignment.count(),
    });
    const afterFirst = await counts();
    const second = await seed(prisma);
    const afterSecond = await counts();

    expect(first).toEqual({ created: TICKETS.length, skipped: 0 });
    expect(second).toEqual({ created: 0, skipped: TICKETS.length });
    expect(afterSecond).toEqual(afterFirst);
    expect(afterFirst).toMatchObject({ users: 4, customers: 6, tickets: 15, messages: 15 });

    const vip = await prisma.ticket.findFirstOrThrow({
      where: { customer: { tier: 'VIP' } },
      include: { events: true },
    });
    expect(vip.events.map((e) => e.type)).toContain('CREATED');
  });
});

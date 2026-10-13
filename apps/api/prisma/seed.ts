import { PrismaClient } from '@prisma/client';
import { SLA_HOURS_BY_TIER } from '@copilot/shared';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateEnv } from '../src/config/env.validation';
import type { EmbeddingProvider } from '../src/modules/ai/providers/llm-provider';
import { createEmbeddingProvider } from '../src/modules/ai/providers/provider-factory';
import { KbIngestor, type IngestResult } from '../src/modules/kb/kb-ingestor';
import { AGENTS, CUSTOMERS, TICKETS } from './seed-data';

/**
 * Idempotent seed: agents and customers are upserted by id; tickets are created once (with their initial
 * message and audit events) and never modified on re-runs, so agent work done in the app is preserved.
 */
export async function seed(prisma: PrismaClient): Promise<{ created: number; skipped: number }> {
  for (const agent of AGENTS) {
    await prisma.user.upsert({
      where: { id: agent.id },
      create: agent,
      update: { email: agent.email, name: agent.name, role: agent.role },
    });
  }

  for (const customer of CUSTOMERS) {
    await prisma.customer.upsert({
      where: { id: customer.id },
      create: customer,
      update: {
        email: customer.email,
        name: customer.name,
        company: customer.company,
        tier: customer.tier,
      },
    });
  }

  const tierById = new Map(CUSTOMERS.map((c) => [c.id, c.tier]));
  const existing = new Set(
    (
      await prisma.ticket.findMany({
        where: { id: { in: TICKETS.map((t) => t.id) } },
        select: { id: true },
      })
    ).map((t) => t.id),
  );

  let created = 0;
  // Create in chronological order so ticket numbers follow creation time.
  for (const t of [...TICKETS].sort((a, b) => b.hoursAgo - a.hoursAgo)) {
    if (existing.has(t.id)) continue;

    const createdAt = new Date(Date.now() - t.hoursAgo * 3_600_000);
    const at = (minutes: number) => new Date(createdAt.getTime() + minutes * 60_000);
    const slaDueAt = new Date(
      createdAt.getTime() + SLA_HOURS_BY_TIER[tierById.get(t.customerId)!] * 3_600_000,
    );

    const events: Array<{
      type: 'CREATED' | 'ASSIGNED' | 'STATUS_CHANGED';
      actorType: 'SYSTEM' | 'USER';
      actorId?: string;
      fromValue?: string;
      toValue?: string;
      createdAt: Date;
      metadata?: object;
    }> = [
      {
        type: 'CREATED',
        actorType: 'SYSTEM',
        toValue: 'OPEN',
        createdAt,
        metadata: { source: 'seed', channel: t.channel },
      },
    ];
    if (t.assigneeId) {
      events.push({
        type: 'ASSIGNED',
        actorType: 'USER',
        actorId: t.assigneeId,
        toValue: t.assigneeId,
        createdAt: at(15),
      });
    }
    if (t.status !== 'OPEN') {
      events.push({
        type: 'STATUS_CHANGED',
        actorType: 'USER',
        actorId: t.assigneeId ?? undefined,
        fromValue: 'OPEN',
        toValue: t.status,
        createdAt: at(30),
      });
    }

    await prisma.ticket.create({
      data: {
        id: t.id,
        subject: t.subject,
        body: t.body,
        channel: t.channel,
        status: t.status,
        priority: 'MEDIUM',
        prioritySource: 'DEFAULT',
        customerId: t.customerId,
        assigneeId: t.assigneeId,
        slaDueAt,
        resolvedAt: t.status === 'RESOLVED' ? at(30) : null,
        createdAt,
        version: events.length,
        messages: {
          create: [{ authorType: 'CUSTOMER', authorId: t.customerId, body: t.body, createdAt }],
        },
        assignments: t.assigneeId
          ? {
              create: [
                { assigneeId: t.assigneeId, assignedById: t.assigneeId, assignedAt: at(15) },
              ],
            }
          : undefined,
        events: { create: events },
      },
    });
    created++;
  }

  return { created, skipped: TICKETS.length - created };
}

/**
 * The seed knowledge base (apps/api/seed/kb). Resolved from both the source tree (prisma/) and the
 * compiled output (dist/prisma/), so `pnpm db:seed` and the Docker image find the same files.
 */
export function seedKbDirectory(): string {
  const candidates = [join(__dirname, '../seed/kb'), join(__dirname, '../../seed/kb')];
  const dir = candidates.find((d) => existsSync(d));
  if (!dir) throw new Error(`Seed knowledge base not found (looked in ${candidates.join(', ')})`);
  return dir;
}

/** Ingests the seed KB. Idempotent: unchanged documents are skipped, edited ones re-indexed. */
export function seedKnowledgeBase(
  prisma: PrismaClient,
  embedder: EmbeddingProvider,
): Promise<IngestResult[]> {
  return new KbIngestor(prisma, embedder).ingestDirectory(seedKbDirectory());
}

async function main(): Promise<void> {
  const env = validateEnv(process.env);
  const prisma = new PrismaClient();
  try {
    const { created, skipped } = await seed(prisma);
    console.log(
      `[seed] ${AGENTS.length} agents, ${CUSTOMERS.length} customers upserted; tickets: ${created} created, ${skipped} already present`,
    );
    const embedder = createEmbeddingProvider(env);
    const kb = await seedKnowledgeBase(prisma, embedder);
    const by = (status: string) => kb.filter((r) => r.status === status).length;
    console.log(
      `[seed] knowledge base (${embedder.model}): ${kb.length} documents, ` +
        `${kb.reduce((n, r) => n + r.chunks, 0)} chunks; created ${by('created')}, updated ${by('updated')}, ` +
        `re-embedded ${by('reembedded')}, unchanged ${by('unchanged')}, failed ${by('failed')}`,
    );
    if (by('failed') > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed] failed', err);
    process.exit(1);
  });
}

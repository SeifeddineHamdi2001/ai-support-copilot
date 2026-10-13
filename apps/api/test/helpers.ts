import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { CustomerTier, PrismaClient, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { LLM_PROVIDER, type LlmProvider } from '../src/modules/ai/providers/llm-provider';

/**
 * Boots the real app (same configuration as main.ts) against the integration database. `llm` replaces
 * the LLM provider (the only thing mocked in integration tests); the default is the env's mock provider.
 * `rateLimit` sets the AI routes' limit per minute (global setup makes it effectively unlimited).
 */
export async function createTestApp(
  options: { llm?: LlmProvider; rateLimit?: number } = {},
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.llm) builder = builder.overrideProvider(LLM_PROVIDER).useValue(options.llm);
  if (options.rateLimit !== undefined) {
    builder = builder
      .overrideProvider(getOptionsToken())
      .useValue({ throttlers: [{ ttl: 60_000, limit: options.rateLimit }] });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}

/** Empties every application table (keeps the migrations table), so each test starts clean. */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!tables.length) return;
  // Table names come from the catalog, not from user input.
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

export function createAgent(
  prisma: PrismaClient,
  overrides: Partial<{ name: string; role: UserRole; isActive: boolean }> = {},
) {
  const suffix = randomUUID().slice(0, 8);
  return prisma.user.create({
    data: {
      email: `agent-${suffix}@acme-support.test`,
      name: overrides.name ?? `Agent ${suffix}`,
      role: overrides.role ?? 'MANAGER',
      isActive: overrides.isActive ?? true,
    },
  });
}

export function createCustomer(
  prisma: PrismaClient,
  overrides: Partial<{ name: string; tier: CustomerTier; company: string }> = {},
) {
  const suffix = randomUUID().slice(0, 8);
  return prisma.customer.create({
    data: {
      email: `customer-${suffix}@example.test`,
      name: overrides.name ?? `Customer ${suffix}`,
      company: overrides.company ?? null,
      tier: overrides.tier ?? 'STANDARD',
    },
  });
}

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

declare global {
  var __PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

/**
 * Provides a migrated, empty Postgres (with pgvector) for the integration run:
 * - TEST_DATABASE_URL set (local dev without Docker): drops and recreates that database on the
 *   local server. The database name must end in `_test` so a dev database can never be wiped.
 * - otherwise (CI): starts a throwaway pgvector/pgvector:pg16 container with Testcontainers.
 * Then applies migrations with `prisma migrate deploy`, the same path production uses.
 */
export default async function globalSetup(): Promise<void> {
  loadRootEnv();

  const url = process.env.TEST_DATABASE_URL
    ? await recreateLocalDatabase(process.env.TEST_DATABASE_URL)
    : await startContainer();

  // Workers are forked after global setup, so they inherit these (ConfigModule never overrides them).
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.LLM_PROVIDER = 'mock';
  process.env.EMBEDDING_PROVIDER = 'mock';
  delete process.env.GEMINI_API_KEY;

  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}

function loadRootEnv(): void {
  try {
    process.loadEnvFile(join(__dirname, '../../../.env'));
  } catch {
    // No .env file: rely on the real environment (CI).
  }
}

async function startContainer(): Promise<string> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('copilot_test')
    .withUsername('copilot')
    .withPassword('copilot')
    .start();
  globalThis.__PG_CONTAINER__ = container;
  return container.getConnectionUri();
}

async function recreateLocalDatabase(testUrl: string): Promise<string> {
  const url = new URL(testUrl);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(dbName)) {
    throw new Error(
      `TEST_DATABASE_URL must point to a database whose name ends in "_test" (got "${dbName}")`,
    );
  }

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    // dbName is validated above against a strict pattern, so interpolation is safe here.
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }
  return testUrl;
}

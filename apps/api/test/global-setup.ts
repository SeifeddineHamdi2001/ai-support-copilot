import { execFileSync } from 'node:child_process';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

declare global {
  var __PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

/** Starts one pgvector Postgres for the whole integration run and applies migrations with `migrate deploy`. */
export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('copilot_test')
    .withUsername('copilot')
    .withPassword('copilot')
    .start();
  globalThis.__PG_CONTAINER__ = container;

  const url = container.getConnectionUri();
  // Workers are forked after global setup, so they inherit these.
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.LLM_PROVIDER = 'mock';
  process.env.EMBEDDING_PROVIDER = 'mock';
  delete process.env.GEMINI_API_KEY;

  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: `${__dirname}/..`,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}

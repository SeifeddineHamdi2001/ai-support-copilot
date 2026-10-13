#!/usr/bin/env node
// Guards the hand-written pgvector / full-text indexes on "KbChunk".
// Prisma does not know these indexes, so `prisma migrate dev` may generate DROP INDEX statements for them.
// Fails if:
//   1. a vector/FTS migration is missing or no longer creates a protected index, or
//   2. any later migration drops either index.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'apps/api/prisma/migrations');
const VECTOR_MIGRATION_SUFFIX = '_vector_fts_indexes';
const PROTECTED = ['kb_chunk_embedding_hnsw', 'kb_chunk_fts_gin', 'kb_chunk_fts_simple_gin'];

const fail = (msg) => {
  console.error(`check:migrations FAILED: ${msg}`);
  process.exit(1);
};

const folders = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const vectorIdx = folders.findIndex((f) => f.endsWith(VECTOR_MIGRATION_SUFFIX));
if (vectorIdx === -1) fail(`no migration folder ending in "${VECTOR_MIGRATION_SUFFIX}"`);

const sqlOf = (folder) => {
  const file = join(migrationsDir, folder, 'migration.sql');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

// Strip SQL line comments so documentation mentioning DROP INDEX does not trigger false positives.
const stripComments = (sql) => sql.replace(/--.*$/gm, '');

for (const name of PROTECTED) {
  const created = folders
    .slice(vectorIdx)
    .some((folder) =>
      new RegExp(`CREATE\\s+INDEX\\s+(IF\\s+NOT\\s+EXISTS\\s+)?"?${name}"?`, 'i').test(
        stripComments(sqlOf(folder)),
      ),
    );
  if (!created) fail(`no vector/FTS migration creates index ${name}`);
}

const problems = [];
for (const folder of folders.slice(vectorIdx + 1)) {
  const sql = stripComments(sqlOf(folder));
  for (const name of PROTECTED) {
    const drop = new RegExp(
      `DROP\\s+INDEX\\s+(CONCURRENTLY\\s+)?(IF\\s+EXISTS\\s+)?("?public"?\\.)?"?${name}"?`,
      'i',
    );
    if (drop.test(sql)) problems.push(`${folder}/migration.sql drops ${name}`);
  }
}

if (problems.length) {
  fail(
    `${problems.join('; ')}.\nRemove the DROP INDEX line(s): these indexes are managed by ${folders[vectorIdx]}.`,
  );
}

console.log(
  `check:migrations OK: ${folders.length} migrations, ${PROTECTED.join(' + ')} protected after ${folders[vectorIdx]}`,
);

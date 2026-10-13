import { PrismaClient } from '@prisma/client';
import { validateEnv } from '../src/config/env.validation';
import { createEmbeddingProvider } from '../src/modules/ai/providers/provider-factory';
import { KbIngestor } from '../src/modules/kb/kb-ingestor';

/**
 * Re-embeds every knowledge base chunk with the current EMBEDDING_PROVIDER. Run after switching providers:
 * search only uses chunks embedded with the current model.  pnpm kb:reindex
 */
async function main(): Promise<void> {
  const env = validateEnv(process.env);
  const prisma = new PrismaClient();
  try {
    const embedder = createEmbeddingProvider(env);
    const results = await new KbIngestor(prisma, embedder).reindexAll();
    for (const r of results) {
      console.log(`[kb:reindex] ${r.document.slug}: ${r.status} (${r.chunks} chunks)`);
    }
    const failed = results.filter((r) => r.status === 'failed').length;
    console.log(
      `[kb:reindex] ${results.length} documents with ${embedder.model}, ${failed} failed`,
    );
    if (failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[kb:reindex] failed', err);
  process.exit(1);
});

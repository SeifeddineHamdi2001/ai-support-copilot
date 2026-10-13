import { Prisma, type KbDocument, type PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EmbeddingProvider } from '../ai/providers/llm-provider';
import { chunkEmbeddingText, chunkMarkdown, type MarkdownChunk } from './chunk-markdown';
import { parseFrontMatter } from './front-matter';

/** Texts per embedding request. */
export const EMBED_BATCH_SIZE = 32;
const MAX_ERROR_LENGTH = 500;

export interface KbDocumentInput {
  title: string;
  slug: string;
  category: string;
  /** Markdown without front matter. */
  body: string;
  sourceUri?: string | null;
}

export type IngestStatus = 'created' | 'updated' | 'unchanged' | 'reembedded' | 'failed';

export interface IngestResult {
  document: KbDocument;
  status: IngestStatus;
  chunks: number;
}

type Db = PrismaClient | Prisma.TransactionClient;

/** pgvector literal, e.g. "[0.1,0.2]"; bound as a parameter and cast with ::vector. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

export function contentHash(input: Pick<KbDocumentInput, 'title' | 'category' | 'body'>): string {
  return createHash('sha256')
    .update(`${input.title}\n${input.category}\n${input.body.replace(/\r\n/g, '\n').trim()}`)
    .digest('hex');
}

/**
 * Indexes Markdown documents into KbDocument / KbChunk. A plain class (no Nest) so the seed and the
 * reindex script use exactly the same code as the API.
 *
 * Ingest is idempotent and failure-safe: an unchanged document (same slug and content hash, embedded
 * with the current model) is skipped; otherwise all embeddings are computed first and the document,
 * its chunks and their vectors are replaced in one transaction. If embedding fails, the previous
 * chunks stay searchable and the document is marked FAILED with the error.
 */
export class KbIngestor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly embedder: EmbeddingProvider,
  ) {}

  async ingest(input: KbDocumentInput): Promise<IngestResult> {
    const hash = contentHash(input);
    const existing = await this.prisma.kbDocument.findUnique({ where: { slug: input.slug } });

    if (existing?.contentHash === hash && existing.status === 'INDEXED') {
      const stale = await this.staleChunkCount(existing.id);
      if (stale === 0) {
        return {
          document: existing,
          status: 'unchanged',
          chunks: await this.chunkCount(existing.id),
        };
      }
      // Same content, different embedding model (provider switched): re-embed only.
      const reindexed = await this.reindex(existing.id);
      return { ...reindexed, status: reindexed.status === 'failed' ? 'failed' : 'reembedded' };
    }

    const chunks = chunkMarkdown(input.body, { title: input.title });
    let vectors: number[][];
    try {
      vectors = await this.embedAll(chunks);
    } catch (err) {
      const document = await this.prisma.kbDocument.upsert({
        where: { slug: input.slug },
        // A new document records the failure; an existing one keeps its old chunks and content hash.
        create: {
          ...documentFields(input),
          contentHash: hash,
          status: 'FAILED',
          error: errorText(err),
        },
        update: { status: 'FAILED', error: errorText(err) },
      });
      return { document, status: 'failed', chunks: 0 };
    }

    const document = await this.prisma.$transaction(
      async (tx) => {
        const doc = await tx.kbDocument.upsert({
          where: { slug: input.slug },
          create: { ...documentFields(input), contentHash: hash, status: 'INDEXED' },
          update: { ...documentFields(input), contentHash: hash, status: 'INDEXED', error: null },
        });
        // Citations of replaced chunks keep documentId + quote (chunkId is set to NULL by the FK).
        await tx.kbChunk.deleteMany({ where: { documentId: doc.id } });
        const ids = chunks.map(() => randomUUID());
        await tx.kbChunk.createMany({
          data: chunks.map((c, i) => ({
            id: ids[i],
            documentId: doc.id,
            ordinal: c.ordinal,
            headingPath: c.headingPath,
            content: c.content,
            tokenCount: c.tokenCount,
          })),
        });
        await this.writeVectors(tx, ids, vectors);
        return doc;
      },
      { timeout: 30_000 },
    );
    return { document, status: existing ? 'updated' : 'created', chunks: chunks.length };
  }

  /** Re-embeds a document's existing chunks with the current provider (after switching providers). */
  async reindex(documentId: string): Promise<IngestResult> {
    const chunks = await this.prisma.kbChunk.findMany({
      where: { documentId },
      orderBy: { ordinal: 'asc' },
      select: { id: true, ordinal: true, headingPath: true, content: true, tokenCount: true },
    });
    let vectors: number[][];
    try {
      vectors = await this.embedAll(chunks);
    } catch (err) {
      const document = await this.prisma.kbDocument.update({
        where: { id: documentId },
        data: { status: 'FAILED', error: errorText(err) },
      });
      return { document, status: 'failed', chunks: chunks.length };
    }
    const document = await this.prisma.$transaction(
      async (tx) => {
        await this.writeVectors(
          tx,
          chunks.map((c) => c.id),
          vectors,
        );
        return tx.kbDocument.update({
          where: { id: documentId },
          data: { status: 'INDEXED', error: null },
        });
      },
      { timeout: 30_000 },
    );
    return { document, status: 'reembedded', chunks: chunks.length };
  }

  async reindexAll(): Promise<IngestResult[]> {
    const docs = await this.prisma.kbDocument.findMany({
      select: { id: true },
      orderBy: { slug: 'asc' },
    });
    const results: IngestResult[] = [];
    for (const d of docs) results.push(await this.reindex(d.id));
    return results;
  }

  /** Ingests every `*.md` file of a directory; front matter supplies title, slug and category. */
  async ingestDirectory(dir: string): Promise<IngestResult[]> {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
    const results: IngestResult[] = [];
    for (const file of files) {
      const { attributes, body } = parseFrontMatter(await readFile(join(dir, file), 'utf8'));
      const slug = attributes.slug || file.replace(/\.md$/, '');
      results.push(
        await this.ingest({
          title: attributes.title || slug,
          slug,
          category: attributes.category || 'general',
          body,
          sourceUri: `seed/kb/${file}`,
        }),
      );
    }
    return results;
  }

  private async embedAll(
    chunks: Pick<MarkdownChunk, 'headingPath' | 'content'>[],
  ): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE).map(chunkEmbeddingText);
      const out = await this.embedder.embedDocuments(batch);
      if (out.length !== batch.length || out.some((v) => v.length !== this.embedder.dimensions)) {
        throw new Error(
          `Embedding provider returned ${out.length} vectors for ${batch.length} texts ` +
            `(expected ${this.embedder.dimensions} dimensions each)`,
        );
      }
      vectors.push(...out);
    }
    return vectors;
  }

  /** Prisma Client cannot write `Unsupported("vector")` columns, so vectors go through bound raw SQL. */
  private async writeVectors(tx: Db, ids: string[], vectors: number[][]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      await tx.$executeRaw`
        UPDATE "KbChunk"
        SET embedding = ${toVectorLiteral(vectors[i])}::vector, "embeddingModel" = ${this.embedder.model}
        WHERE id = ${ids[i]}::uuid`;
    }
  }

  private chunkCount(documentId: string): Promise<number> {
    return this.prisma.kbChunk.count({ where: { documentId } });
  }

  /** Chunks not embedded with the current model (missing vector or another provider's model). */
  private staleChunkCount(documentId: string): Promise<number> {
    return this.prisma.kbChunk.count({
      where: {
        documentId,
        OR: [{ embeddingModel: null }, { embeddingModel: { not: this.embedder.model } }],
      },
    });
  }
}

function documentFields(input: KbDocumentInput) {
  return {
    title: input.title,
    slug: input.slug,
    category: input.category,
    sourceUri: input.sourceUri ?? null,
  };
}

function errorText(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, MAX_ERROR_LENGTH);
}

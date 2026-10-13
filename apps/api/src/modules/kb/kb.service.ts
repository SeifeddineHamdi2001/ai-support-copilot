import { Inject, Injectable } from '@nestjs/common';
import { AiUnavailableError, NotFoundError } from '../../common/errors/app-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from '../ai/providers/llm-provider';
import type {
  CreateKbDocumentDto,
  IngestResultDto,
  KbDocumentDetailDto,
  KbDocumentDto,
} from './dto/kb.dto';
import { KbIngestor, type IngestResult } from './kb-ingestor';

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .slice(0, 100) || 'document'
  );
}

@Injectable()
export class KbService {
  private readonly ingestor: KbIngestor;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_PROVIDER) embedder: EmbeddingProvider,
  ) {
    this.ingestor = new KbIngestor(prisma, embedder);
  }

  /** Creates or replaces (by slug) a document and indexes it. 503 if the embedding provider fails. */
  async upsert(dto: CreateKbDocumentDto): Promise<IngestResultDto> {
    const result = await this.ingestor.ingest({
      title: dto.title,
      slug: dto.slug ?? slugify(dto.title),
      category: dto.category,
      body: dto.content,
    });
    return this.toResult(result);
  }

  async list(): Promise<KbDocumentDto[]> {
    const docs = await this.prisma.kbDocument.findMany({
      orderBy: { title: 'asc' },
      include: { _count: { select: { chunks: true } } },
    });
    return docs.map(({ _count, ...d }) => ({ ...d, chunkCount: _count.chunks }));
  }

  async get(id: string): Promise<KbDocumentDetailDto> {
    const doc = await this.prisma.kbDocument.findUnique({
      where: { id },
      include: {
        chunks: {
          orderBy: { ordinal: 'asc' },
          select: {
            id: true,
            ordinal: true,
            headingPath: true,
            content: true,
            tokenCount: true,
            embeddingModel: true,
          },
        },
      },
    });
    if (!doc) throw new NotFoundError('KbDocument', id);
    return { ...doc, chunkCount: doc.chunks.length };
  }

  /**
   * Deletes the document, its chunks and the draft citations pointing at it (FK cascade). Drafts stay;
   * an approved reply already lives in the conversation. Editing a document instead keeps citations.
   */
  async remove(id: string): Promise<void> {
    await this.prisma.kbDocument.delete({ where: { id } });
  }

  async reindex(id: string): Promise<IngestResultDto> {
    const exists = await this.prisma.kbDocument.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundError('KbDocument', id);
    return this.toResult(await this.ingestor.reindex(id));
  }

  private async toResult(result: IngestResult): Promise<IngestResultDto> {
    if (result.status === 'failed') {
      throw new AiUnavailableError(
        `The embedding provider failed, so "${result.document.slug}" was not (re)indexed. ` +
          'Previously indexed chunks are still searchable; retry with POST /kb/documents/:id/reindex.',
      );
    }
    return {
      status: result.status,
      chunks: result.chunks,
      document: { ...result.document, chunkCount: result.chunks },
    };
  }
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { $Enums } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CleanText } from '../../../common/http/validators';
import { MAX_QUERY_LENGTH } from '../kb-search.service';

export const KB_LIMITS = { title: 200, slug: 100, category: 50, content: 100_000 } as const;

export class CreateKbDocumentDto {
  @ApiProperty({ example: 'Refund Policy', maxLength: KB_LIMITS.title })
  @CleanText()
  @IsString()
  @MinLength(3)
  @MaxLength(KB_LIMITS.title)
  title: string;

  @ApiPropertyOptional({
    example: 'refund-policy',
    description:
      'Unique key. Defaults to a slug of the title. Posting an existing slug replaces it.',
    maxLength: KB_LIMITS.slug,
  })
  @IsOptional()
  @CleanText()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be lowercase words joined by -' })
  @MaxLength(KB_LIMITS.slug)
  slug?: string;

  @ApiProperty({ example: 'billing', maxLength: KB_LIMITS.category })
  @CleanText()
  @IsString()
  @MinLength(2)
  @MaxLength(KB_LIMITS.category)
  category: string;

  @ApiProperty({
    description: 'Markdown body. Headings (#, ##, ###) become the chunk heading paths.',
    maxLength: KB_LIMITS.content,
  })
  @CleanText({ html: true })
  @IsString()
  @MinLength(20)
  @MaxLength(KB_LIMITS.content)
  content: string;
}

export class KbSearchDto {
  @ApiProperty({ example: 'I was charged twice, can I get a refund?', maxLength: MAX_QUERY_LENGTH })
  @CleanText()
  @IsString()
  @MinLength(2)
  @MaxLength(MAX_QUERY_LENGTH)
  query: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, description: 'Defaults to RAG_TOP_K' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  k?: number;
}

export class KbDocumentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty() slug: string;
  @ApiProperty() category: string;
  @ApiProperty({ type: String, nullable: true }) sourceUri: string | null;
  @ApiProperty({ description: 'sha256 of title, category and body; unchanged content is skipped' })
  contentHash: string;
  @ApiProperty({ enum: $Enums.KbDocumentStatus }) status: $Enums.KbDocumentStatus;
  @ApiProperty({ type: String, nullable: true }) error: string | null;
  @ApiProperty() chunkCount: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class KbChunkDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() ordinal: number;
  @ApiProperty({ example: 'Refund Policy > Annual plans' }) headingPath: string;
  @ApiProperty() content: string;
  @ApiProperty() tokenCount: number;
  @ApiProperty({ type: String, nullable: true }) embeddingModel: string | null;
}

export class KbDocumentDetailDto extends KbDocumentDto {
  @ApiProperty({ type: [KbChunkDto] }) chunks: KbChunkDto[];
}

export class IngestResultDto {
  @ApiProperty({ enum: ['created', 'updated', 'unchanged', 'reembedded'] }) status: string;
  @ApiProperty() chunks: number;
  @ApiProperty({ type: KbDocumentDto }) document: KbDocumentDto;
}

export class KbSearchHitDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) documentId: string;
  @ApiProperty() title: string;
  @ApiProperty() slug: string;
  @ApiProperty() headingPath: string;
  @ApiProperty() content: string;
  @ApiProperty({ description: 'Reciprocal Rank Fusion score (k=60)' }) rrf: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Cosine similarity to the query' })
  similarity: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Rank in the vector top 20' })
  semanticRank: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Rank in the full-text top 20' })
  lexicalRank: number | null;
}

export class KbSearchResultDto {
  @ApiProperty({ type: [KbSearchHitDto], description: 'Chunks above the similarity floor' })
  results: KbSearchHitDto[];
  @ApiProperty({ type: [KbSearchHitDto], description: 'Top-K chunks dropped by the floor' })
  belowFloor: KbSearchHitDto[];
  @ApiProperty() minSimilarity: number;
  @ApiProperty() topK: number;
  @ApiProperty() embeddingModel: string;
  @ApiProperty({ description: 'Chunks needing `pnpm kb:reindex` (embedded with another model)' })
  staleChunks: number;
}

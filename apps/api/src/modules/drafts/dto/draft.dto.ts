import { TICKET_LIMITS } from '@copilot/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CleanText } from '../../../common/http/validators';
import { $Enums } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { UserSummaryDto } from '../../tickets/dto/ticket-responses.dto';

export const REVIEW_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export class ReviewDraftDto {
  @ApiProperty({ enum: REVIEW_DECISIONS })
  @IsIn(REVIEW_DECISIONS)
  status: ReviewDecision;

  @ApiPropertyOptional({
    description: 'Edited reply text (APPROVED only). Defaults to the draft content.',
    maxLength: TICKET_LIMITS.body,
  })
  @IsOptional()
  @CleanText()
  @IsString()
  @MinLength(1)
  @MaxLength(TICKET_LIMITS.body)
  content?: string;
}

export class CitedDocumentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty() slug: string;
}

export class CitedChunkDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() headingPath: string;
  @ApiProperty() content: string;
}

export class DraftCitationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'S1', description: 'Marker used in the draft text' }) label: string;
  @ApiProperty({ description: 'Retrieval rank (the number in the marker)' }) rank: number;
  @ApiProperty({ description: 'Cosine similarity of the chunk to the ticket' }) score: number;
  @ApiProperty({ type: String, nullable: true }) quote: string | null;
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'null if the chunk was replaced by a re-index',
  })
  chunkId: string | null;
  @ApiProperty({ format: 'uuid' }) documentId: string;
  @ApiProperty({ type: CitedDocumentDto }) document: CitedDocumentDto;
  @ApiProperty({ type: CitedChunkDto, nullable: true }) chunk: CitedChunkDto | null;
}

export class DraftDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) ticketId: string;
  @ApiProperty() content: string;
  @ApiProperty({
    description: 'false = no grounded answer; content is a safe holding reply with no citations',
  })
  answerable: boolean;
  @ApiProperty({ minimum: 0, maximum: 1 }) confidence: number;
  @ApiProperty({ type: [String] }) missingInformation: string[];
  @ApiProperty({ enum: $Enums.DraftStatus }) status: $Enums.DraftStatus;
  @ApiProperty({ example: 'gemini' }) provider: string;
  @ApiProperty({ example: 'gemini-2.5-flash-lite' }) model: string;
  @ApiProperty({ example: 'draft@v1' }) promptVersion: string;
  @ApiProperty({ enum: $Enums.AiOutcome }) outcome: $Enums.AiOutcome;
  @ApiProperty({ type: String, nullable: true }) errorMessage: string | null;
  @ApiProperty() latencyMs: number;
  @ApiProperty({ type: UserSummaryDto, nullable: true }) reviewedBy: UserSummaryDto | null;
  @ApiProperty({ type: Date, nullable: true }) reviewedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: [DraftCitationDto] }) citations: DraftCitationDto[];
}

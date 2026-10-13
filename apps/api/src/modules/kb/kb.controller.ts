import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProblemDetailsDto } from '../../common/http/problem-details.dto';
import { CurrentActor, type Actor } from '../../common/http/actor';
import { Roles } from '../../common/auth/auth';
import { AiRateLimited } from '../../common/http/rate-limit';
import {
  CreateKbDocumentDto,
  IngestResultDto,
  KbDocumentDetailDto,
  KbDocumentDto,
  KbSearchDto,
  KbSearchResultDto,
} from './dto/kb.dto';
import { KbSearchService } from './kb-search.service';
import { KbService } from './kb.service';

const EmbeddingUnavailable = () =>
  ApiServiceUnavailableResponse({
    type: ProblemDetailsDto,
    description: 'Embedding provider unavailable (AI_PROVIDER_UNAVAILABLE)',
  });

@ApiTags('knowledge base')
@ApiBadRequestResponse({ type: ProblemDetailsDto, description: 'Validation failed' })
@Controller('kb')
export class KbController {
  constructor(
    private readonly kb: KbService,
    private readonly search: KbSearchService,
  ) {}

  @Post('documents')
  @Roles('MANAGER', 'ADMIN')
  @AiRateLimited()
  @ApiOperation({
    summary: 'Add or replace a Markdown document (by slug) and index it',
    description:
      'Chunks by heading (~500 tokens, ~15% overlap), embeds in batches and replaces the chunks in one ' +
      'transaction. Unchanged content (same hash, same embedding model) is skipped.',
  })
  @ApiCreatedResponse({ type: IngestResultDto })
  @EmbeddingUnavailable()
  create(@Body() dto: CreateKbDocumentDto, @CurrentActor() _actor: Actor) {
    return this.kb.upsert(dto);
  }

  @Get('documents')
  @ApiOperation({ summary: 'List knowledge base documents with chunk counts' })
  @ApiOkResponse({ type: [KbDocumentDto] })
  list() {
    return this.kb.list();
  }

  @Get('documents/:id')
  @ApiOperation({ summary: 'Get a document with its chunks' })
  @ApiOkResponse({ type: KbDocumentDetailDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.kb.get(id);
  }

  @Delete('documents/:id')
  @Roles('MANAGER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a document and its chunks (citations keep their quotes)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() _actor: Actor) {
    await this.kb.remove(id);
  }

  @Post('documents/:id/reindex')
  @Roles('MANAGER', 'ADMIN')
  @AiRateLimited()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-embed a document with the current embedding provider' })
  @ApiOkResponse({ type: IngestResultDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @EmbeddingUnavailable()
  reindex(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() _actor: Actor) {
    return this.kb.reindex(id);
  }

  @Post('search')
  @AiRateLimited()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hybrid search (vector + full-text, RRF k=60, similarity floor) with scores',
  })
  @ApiOkResponse({ type: KbSearchResultDto })
  @EmbeddingUnavailable()
  searchKb(@Body() dto: KbSearchDto) {
    return this.search.search(dto.query, dto.k);
  }
}

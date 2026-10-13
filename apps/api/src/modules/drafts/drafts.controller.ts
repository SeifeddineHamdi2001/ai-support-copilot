import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentActor, OptionalActor, type Actor } from '../../common/http/actor';
import { ProblemDetailsDto } from '../../common/http/problem-details.dto';
import { AiRateLimited } from '../../common/http/rate-limit';
import { DraftDto, ReviewDraftDto } from './dto/draft.dto';
import { DraftsService } from './drafts.service';

@ApiTags('drafts')
@ApiBadRequestResponse({ type: ProblemDetailsDto, description: 'Validation failed' })
@Controller()
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Post('tickets/:id/drafts')
  @AiRateLimited()
  @ApiHeader({ name: 'X-User-Id', required: false, description: 'Requesting agent (audit)' })
  @ApiOperation({
    summary: 'Generate a grounded reply draft with citations',
    description:
      'Hybrid KB retrieval, then the LLM answers only from the retrieved chunks and cites them as [S#]. ' +
      'Citations are allow-listed against the retrieved chunks. If nothing passes the similarity floor ' +
      'or no valid citation remains, the draft is a safe holding reply with answerable=false. ' +
      'Never sent automatically.',
  })
  @ApiCreatedResponse({ type: DraftDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto, description: 'Ticket is closed' })
  @ApiServiceUnavailableResponse({
    type: ProblemDetailsDto,
    description: 'LLM or embedding provider unavailable (the run is still recorded)',
  })
  generate(@Param('id', ParseUUIDPipe) id: string, @OptionalActor() actor: Actor) {
    return this.drafts.generate(id, actor);
  }

  @Get('tickets/:id/drafts')
  @ApiOperation({ summary: 'Drafts of a ticket, newest first, with citations' })
  @ApiOkResponse({ type: [DraftDto] })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.list(id);
  }

  @Patch('drafts/:id')
  @ApiHeader({ name: 'X-User-Id', required: true, description: 'Reviewing agent (required)' })
  @ApiOperation({
    summary: 'Approve (optionally edited) or reject a draft',
    description:
      'Approving creates an AGENT TicketMessage with the final text and a DRAFT_APPROVED event; rejecting ' +
      'records DRAFT_REJECTED. A draft can be reviewed once.',
  })
  @ApiOkResponse({ type: DraftDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({
    type: ProblemDetailsDto,
    description: 'DRAFT_ALREADY_REVIEWED or TICKET_CLOSED',
  })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDraftDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.drafts.review(id, dto, actor);
  }
}

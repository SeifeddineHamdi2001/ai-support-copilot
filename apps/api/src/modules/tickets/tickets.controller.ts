import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentActor, Roles } from '../../common/auth/auth';
import type { Actor } from '../../common/http/actor';
import { ProblemDetailsDto } from '../../common/http/problem-details.dto';
import { AiRateLimited } from '../../common/http/rate-limit';
import { ClassificationService } from '../ai/classification/classification.service';
import {
  AssignTicketDto,
  ChangeStatusDto,
  CreateTicketDto,
  CreateTicketMessageDto,
  ListTicketsQueryDto,
  UpdateTicketDto,
} from './dto/ticket-requests.dto';
import {
  AiClassificationDto,
  ClassifyResultDto,
  TicketDetailDto,
  TicketEventDto,
  TicketPageDto,
} from './dto/ticket-responses.dto';
import { TicketsService } from './tickets.service';

@ApiTags('tickets')
@ApiBadRequestResponse({ type: ProblemDetailsDto, description: 'Validation failed' })
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly classifications: ClassificationService,
  ) {}

  @Post()
  @AiRateLimited()
  @ApiOperation({
    summary: 'Create a ticket',
    description:
      'Writes the ticket, the first customer message and a CREATED event in one transaction. ' +
      'The authenticated user is recorded as the creator. After that commit the ticket is ' +
      'classified by the LLM; if the AI fails the ticket is still returned with DEFAULT priority.',
  })
  @ApiCreatedResponse({ type: TicketDetailDto })
  @ApiUnprocessableEntityResponse({ type: ProblemDetailsDto, description: 'Unknown customer' })
  create(@Body() dto: CreateTicketDto, @CurrentActor() actor: Actor) {
    return this.tickets.create(dto, actor);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Add a manual agent reply to the conversation' })
  @ApiOkResponse({ type: TicketDetailDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto, description: 'Stale version or closed ticket' })
  addMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTicketMessageDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.tickets.addMessage(id, dto, actor);
  }

  @Get()
  @ApiOperation({ summary: 'List tickets (filters, search, sort, pagination)' })
  @ApiOkResponse({ type: TicketPageDto })
  list(@Query() query: ListTicketsQueryDto, @CurrentActor() actor: Actor) {
    return this.tickets.list(query, actor);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a ticket with messages, assignment history and allowed transitions',
  })
  @ApiOkResponse({ type: TicketDetailDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.get(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Set priority and/or intent manually',
    description:
      'A manual priority sets prioritySource=MANUAL, which AI classification never overrides.',
  })
  @ApiOkResponse({ type: TicketDetailDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto, description: 'Stale version or closed ticket' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.tickets.update(id, dto, actor);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change status (validated against the ticket state machine)' })
  @ApiOkResponse({ type: TicketDetailDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({
    type: ProblemDetailsDto,
    description: 'INVALID_STATUS_TRANSITION or TICKET_VERSION_CONFLICT',
  })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.tickets.changeStatus(id, dto, actor);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @Roles('MANAGER', 'ADMIN')
  @ApiOperation({ summary: 'Assign, reassign or unassign (assigneeId: null); keeps history' })
  @ApiOkResponse({ type: TicketDetailDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto, description: 'Stale version or closed ticket' })
  @ApiUnprocessableEntityResponse({
    type: ProblemDetailsDto,
    description: 'Unknown or inactive agent',
  })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.tickets.assign(id, dto, actor);
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'Audit timeline (append-only), oldest first' })
  @ApiOkResponse({ type: [TicketEventDto] })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  events(@Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.events(id);
  }

  @Post(':id/classify')
  @AiRateLimited()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Classify (or re-classify) the ticket with the LLM',
    description:
      'Records an AiClassification run. VALID/REPAIRED results set intent and priority (source AI) ' +
      'unless an agent set them manually. The authenticated user is recorded as the requester.',
  })
  @ApiOkResponse({ type: ClassifyResultDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto, description: 'Closed ticket' })
  @ApiServiceUnavailableResponse({
    type: ProblemDetailsDto,
    description: 'AI_PROVIDER_UNAVAILABLE: provider down or timed out; the ticket was not changed',
  })
  classify(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.tickets.classify(id, actor);
  }

  @Get(':id/classifications')
  @ApiOperation({ summary: 'Classification runs for the ticket, newest first' })
  @ApiOkResponse({ type: [AiClassificationDto] })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  listClassifications(@Param('id', ParseUUIDPipe) id: string) {
    return this.classifications.list(id);
  }
}

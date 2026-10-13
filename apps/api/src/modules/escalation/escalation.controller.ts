import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ActingAgentRequired, CurrentActor, Public, Roles } from '../../common/auth/auth';
import { OptionalActor, type Actor } from '../../common/http/actor';
import { ProblemDetailsDto } from '../../common/http/problem-details.dto';
import {
  DecideEscalationDto,
  EscalationDecisionResultDto,
  EscalationDto,
} from './dto/escalation.dto';
import { EscalationService } from './escalation.service';

@ApiTags('escalation')
@ApiBadRequestResponse({ type: ProblemDetailsDto, description: 'Validation failed' })
@Controller()
export class EscalationController {
  constructor(private readonly escalation: EscalationService) {}

  @Post('tickets/:id/escalation/evaluate')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Evaluate escalation rules for a ticket',
    description:
      'Runs the rules engine (URGENT_PRIORITY, SENSITIVE_INTENT, LEGAL_SECURITY, VIP_CUSTOMER, ' +
      'LOW_CONFIDENCE, KB_GAP, ANGRY_REPEAT, SLA_RISK) on the ticket, its latest classification and draft. ' +
      'Model signals count only at confidence ≥ 0.6. Returns the latest recommendation; a new one is ' +
      'stored only when the findings changed. Also runs automatically after classification and drafting.',
  })
  @ApiOkResponse({ type: EscalationDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({
    type: ProblemDetailsDto,
    description: 'ESCALATION_NOT_APPLICABLE: the ticket cannot move to ESCALATED from its status',
  })
  evaluate(@Param('id', ParseUUIDPipe) id: string, @OptionalActor() actor: Actor) {
    return this.escalation.evaluate(id, actor);
  }

  @Get('tickets/:id/escalations')
  @Public()
  @ApiOperation({ summary: 'Escalation evaluations of a ticket, newest first' })
  @ApiOkResponse({ type: [EscalationDto] })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.escalation.list(id);
  }

  @Post('escalations/:id/decision')
  @HttpCode(HttpStatus.OK)
  @Roles('MANAGER', 'ADMIN')
  @ActingAgentRequired()
  @ApiOperation({
    summary: 'Accept or dismiss an escalation recommendation',
    description:
      'ACCEPTED moves the ticket to ESCALATED (requires the ticket version) and records ' +
      'ESCALATION_ACCEPTED + STATUS_CHANGED in the same transaction. DISMISSED records ' +
      'ESCALATION_DISMISSED and leaves the ticket unchanged. Only the latest pending recommendation ' +
      'can be decided, once.',
  })
  @ApiOkResponse({ type: EscalationDecisionResultDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({
    type: ProblemDetailsDto,
    description:
      'ESCALATION_ALREADY_DECIDED, ESCALATION_SUPERSEDED, ESCALATION_NOT_RECOMMENDED, ' +
      'TICKET_VERSION_CONFLICT or INVALID_STATUS_TRANSITION',
  })
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideEscalationDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.escalation.decide(id, dto, actor);
  }
}

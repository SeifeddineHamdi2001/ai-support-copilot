import { ESCALATION_RULES, TICKET_LIMITS } from '@copilot/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { $Enums } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { CleanText } from '../../../common/http/validators';
import { UserSummaryDto } from '../../tickets/dto/ticket-responses.dto';

export const ESCALATION_DECISION_INPUTS = ['ACCEPTED', 'DISMISSED'] as const;
export type EscalationDecisionInput = (typeof ESCALATION_DECISION_INPUTS)[number];

export class DecideEscalationDto {
  @ApiProperty({
    enum: ESCALATION_DECISION_INPUTS,
    description: 'ACCEPTED moves the ticket to ESCALATED; DISMISSED leaves it as is',
  })
  @IsIn(ESCALATION_DECISION_INPUTS)
  decision: EscalationDecisionInput;

  @ApiPropertyOptional({
    example: 3,
    description: 'Ticket version the client last read. Required to accept (it changes the ticket).',
  })
  @ValidateIf((o: DecideEscalationDto) => o.decision === 'ACCEPTED' || o.version !== undefined)
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({ maxLength: TICKET_LIMITS.note, description: 'Stored on the audit event' })
  @IsOptional()
  @CleanText()
  @IsString()
  @MaxLength(TICKET_LIMITS.note)
  note?: string;
}

export class EscalationReasonDto {
  @ApiProperty({ enum: ESCALATION_RULES }) rule: string;
  @ApiProperty({ enum: ['TIER2', 'SPECIALIST', 'MANAGER'] }) level: string;
  @ApiProperty({ example: 'LEGAL_THREAT detected in the ticket text.' }) detail: string;
  @ApiProperty({
    enum: ['RULE', 'LLM'],
    description:
      'RULE: from ticket data alone. LLM: relied on a trusted model signal (confidence ≥ 0.6)',
  })
  source: string;
}

export class EscalationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) ticketId: string;
  @ApiProperty({ description: 'false when no rule fired (level NONE)' }) recommended: boolean;
  @ApiProperty({ enum: $Enums.EscalationLevel }) level: $Enums.EscalationLevel;
  @ApiProperty({ enum: ESCALATION_RULES, isArray: true }) triggeredRules: string[];
  @ApiProperty({ type: [EscalationReasonDto] }) reasons: EscalationReasonDto[];
  @ApiProperty({ enum: $Enums.EscalationDecision }) decision: $Enums.EscalationDecision;
  @ApiProperty({ type: UserSummaryDto, nullable: true }) decidedBy: UserSummaryDto | null;
  @ApiProperty({ type: Date, nullable: true }) decidedAt: Date | null;
  @ApiProperty() createdAt: Date;
}

export class TicketStateDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: $Enums.TicketStatus }) status: $Enums.TicketStatus;
  @ApiProperty({ description: 'New version to send on the next mutation' }) version: number;
}

export class EscalationDecisionResultDto {
  @ApiProperty({ type: EscalationDto }) escalation: EscalationDto;
  @ApiProperty({ type: TicketStateDto }) ticket: TicketStateDto;
}

import { ApiProperty } from '@nestjs/swagger';
import { $Enums } from '@prisma/client';
import { PageMetaDto } from '../../../common/http/pagination';

export class CustomerSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({ type: String, nullable: true }) company: string | null;
  @ApiProperty({ enum: $Enums.CustomerTier }) tier: $Enums.CustomerTier;
}

export class UserSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
}

export class TicketDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 1042, description: 'Human-readable ticket number' }) number: number;
  @ApiProperty() subject: string;
  @ApiProperty() body: string;
  @ApiProperty({ enum: $Enums.TicketChannel }) channel: $Enums.TicketChannel;
  @ApiProperty({ enum: $Enums.TicketStatus }) status: $Enums.TicketStatus;
  @ApiProperty({ enum: $Enums.TicketPriority }) priority: $Enums.TicketPriority;
  @ApiProperty({ enum: $Enums.PrioritySource }) prioritySource: $Enums.PrioritySource;
  @ApiProperty({ enum: $Enums.TicketIntent, nullable: true }) intent: $Enums.TicketIntent | null;
  @ApiProperty({ format: 'uuid' }) customerId: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) assigneeId: string | null;
  @ApiProperty({ description: 'Send back on every mutation (optimistic locking)' }) version: number;
  @ApiProperty({ type: Date, nullable: true }) slaDueAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) resolvedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ type: CustomerSummaryDto }) customer: CustomerSummaryDto;
  @ApiProperty({ type: UserSummaryDto, nullable: true }) assignee: UserSummaryDto | null;
}

export class TicketMessageDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: $Enums.MessageAuthorType }) authorType: $Enums.MessageAuthorType;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) authorId: string | null;
  @ApiProperty() body: string;
  @ApiProperty() createdAt: Date;
}

export class TicketAssignmentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: UserSummaryDto }) assignee: UserSummaryDto;
  @ApiProperty({ type: UserSummaryDto, nullable: true }) assignedBy: UserSummaryDto | null;
  @ApiProperty() assignedAt: Date;
  @ApiProperty({ type: Date, nullable: true, description: 'null while the assignment is current' })
  unassignedAt: Date | null;
}

export class TicketDetailDto extends TicketDto {
  @ApiProperty({ type: [TicketMessageDto] }) messages: TicketMessageDto[];
  @ApiProperty({ type: [TicketAssignmentDto], description: 'Assignment history, newest first' })
  assignments: TicketAssignmentDto[];
  @ApiProperty({
    enum: $Enums.TicketStatus,
    isArray: true,
    description: 'Statuses this ticket can move to next',
  })
  allowedTransitions: $Enums.TicketStatus[];
}

export class TicketPageDto {
  @ApiProperty({ type: [TicketDto] }) items: TicketDto[];
  @ApiProperty({ type: PageMetaDto }) meta: PageMetaDto;
}

export class TicketEventDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: $Enums.TicketEventType }) type: $Enums.TicketEventType;
  @ApiProperty({ enum: $Enums.ActorType }) actorType: $Enums.ActorType;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) actorId: string | null;
  @ApiProperty({
    type: UserSummaryDto,
    nullable: true,
    description: 'Resolved when actorType=USER',
  })
  actor: UserSummaryDto | null;
  @ApiProperty({ type: String, nullable: true }) fromValue: string | null;
  @ApiProperty({ type: String, nullable: true }) toValue: string | null;
  @ApiProperty({ type: Object }) metadata: unknown;
  @ApiProperty() createdAt: Date;
}

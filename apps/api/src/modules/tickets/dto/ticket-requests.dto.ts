import { TICKET_LIMITS, TICKET_SORT_FIELDS } from '@copilot/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { $Enums } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination';
import { IsOptionalNotNull, sortOptions, CleanText } from '../../../common/http/validators';

export class CreateTicketDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId: string;

  @ApiProperty({
    example: 'Charged twice for October',
    minLength: 3,
    maxLength: TICKET_LIMITS.subject,
  })
  @CleanText()
  @IsString()
  @MinLength(3)
  @MaxLength(TICKET_LIMITS.subject)
  subject: string;

  @ApiProperty({
    example: 'My card was charged twice for the October invoice. Please refund the duplicate.',
    minLength: 10,
    maxLength: TICKET_LIMITS.body,
  })
  @CleanText()
  @IsString()
  @MinLength(10)
  @MaxLength(TICKET_LIMITS.body)
  body: string;

  @ApiPropertyOptional({ enum: $Enums.TicketChannel, default: 'WEB' })
  @IsOptional()
  @IsEnum($Enums.TicketChannel)
  channel?: $Enums.TicketChannel;
}

/** Every ticket mutation carries the version the client last saw (optimistic locking). */
export abstract class VersionedDto {
  @ApiProperty({ example: 1, description: 'Ticket version the client last read; 409 if stale' })
  @IsInt()
  @Min(1)
  version: number;
}

export class UpdateTicketDto extends VersionedDto {
  @ApiPropertyOptional({
    enum: $Enums.TicketPriority,
    description: 'Sets prioritySource=MANUAL; AI classification never overrides it afterwards',
  })
  @IsOptionalNotNull()
  @IsEnum($Enums.TicketPriority)
  priority?: $Enums.TicketPriority;

  @ApiPropertyOptional({
    enum: $Enums.TicketIntent,
    nullable: true,
    description: 'Manual intent correction; null clears it',
  })
  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsEnum($Enums.TicketIntent)
  intent?: $Enums.TicketIntent | null;
}

export class CreateTicketMessageDto {
  @ApiProperty({ example: 'Could you share the invoice number?', maxLength: TICKET_LIMITS.body })
  @CleanText()
  @IsString()
  @MinLength(1)
  @MaxLength(TICKET_LIMITS.body)
  body: string;

  @ApiProperty({ example: 1, description: 'Ticket version last read' })
  @IsInt()
  @Min(1)
  version: number;
}

export class ChangeStatusDto extends VersionedDto {
  @ApiProperty({ enum: $Enums.TicketStatus })
  @IsEnum($Enums.TicketStatus)
  status: $Enums.TicketStatus;

  @ApiPropertyOptional({ maxLength: TICKET_LIMITS.note, description: 'Stored on the audit event' })
  @IsOptional()
  @CleanText()
  @IsString()
  @MaxLength(TICKET_LIMITS.note)
  note?: string;
}

export class AssignTicketDto extends VersionedDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Active agent id, or null to unassign',
  })
  @ValidateIf((o: AssignTicketDto) => o.assigneeId !== null)
  @IsUUID()
  assigneeId: string | null;
}

/** Accepts `?status=OPEN&status=IN_PROGRESS` and `?status=OPEN,IN_PROGRESS`. */
const CsvArray = () =>
  Transform(({ value }: { value: unknown }) =>
    value === undefined
      ? undefined
      : (Array.isArray(value) ? value : [value])
          .flatMap((v) => String(v).split(','))
          .filter(Boolean),
  );

export const UNASSIGNED = 'unassigned';

export class ListTicketsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: $Enums.TicketStatus, isArray: true })
  @IsOptional()
  @CsvArray()
  @IsEnum($Enums.TicketStatus, { each: true })
  status?: $Enums.TicketStatus[];

  @ApiPropertyOptional({ enum: $Enums.TicketPriority, isArray: true })
  @IsOptional()
  @CsvArray()
  @IsEnum($Enums.TicketPriority, { each: true })
  priority?: $Enums.TicketPriority[];

  @ApiPropertyOptional({ enum: $Enums.TicketIntent, isArray: true })
  @IsOptional()
  @CsvArray()
  @IsEnum($Enums.TicketIntent, { each: true })
  intent?: $Enums.TicketIntent[];

  @ApiPropertyOptional({ description: `Agent id, or "${UNASSIGNED}" for the unassigned queue` })
  @IsOptional()
  @ValidateIf((o: ListTicketsQueryDto) => o.assigneeId !== UNASSIGNED)
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    description:
      'Case-insensitive match on subject and body; "123" or "#123" also matches ticket number',
    maxLength: 200,
  })
  @IsOptional()
  @CleanText()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: sortOptions(TICKET_SORT_FIELDS), default: '-createdAt' })
  @IsOptional()
  @IsIn(sortOptions(TICKET_SORT_FIELDS))
  sort: string = '-createdAt';
}

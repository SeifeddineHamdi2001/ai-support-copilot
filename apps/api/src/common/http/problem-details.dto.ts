import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FieldErrorDto {
  @ApiProperty({ example: 'subject' })
  field: string;

  @ApiProperty({ example: 'subject must be shorter than or equal to 200 characters' })
  message: string;
}

/** Swagger schema for every error response (see ProblemDetailsFilter). */
export class ProblemDetailsDto {
  @ApiProperty({ example: 'https://errors.copilot.local/ticket-version-conflict' })
  type: string;

  @ApiProperty({ example: 'Version conflict' })
  title: string;

  @ApiProperty({ example: 409 })
  status: number;

  @ApiProperty({ example: 'Ticket was modified by someone else. Reload and retry.' })
  detail: string;

  @ApiProperty({ example: 'TICKET_VERSION_CONFLICT' })
  errorCode: string;

  @ApiPropertyOptional({ type: [FieldErrorDto] })
  errors?: FieldErrorDto[];

  @ApiProperty({ example: '/api/v1/tickets/2f1c…/status' })
  instance: string;
}

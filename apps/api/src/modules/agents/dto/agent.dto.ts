import { ApiProperty } from '@nestjs/swagger';
import { $Enums } from '@prisma/client';

export class AgentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'alex.morgan@acme-support.test' })
  email: string;

  @ApiProperty({ example: 'Alex Morgan' })
  name: string;

  @ApiProperty({ enum: $Enums.UserRole })
  role: $Enums.UserRole;

  @ApiProperty()
  isActive: boolean;
}

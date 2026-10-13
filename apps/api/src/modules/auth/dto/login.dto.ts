import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'alex.morgan@acme-support.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'RelayDemo2026!' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

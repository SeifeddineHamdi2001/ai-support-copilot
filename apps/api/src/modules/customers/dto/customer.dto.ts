import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { $Enums } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PageMetaDto, PaginationQueryDto } from '../../../common/http/pagination';
import { IsOptionalNotNull, sortOptions, Trim } from '../../../common/http/validators';

const LowerTrim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

export class CreateCustomerDto {
  @ApiProperty({ example: 'dana@globex.test', maxLength: 254 })
  @LowerTrim()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Dana Scully', maxLength: 120 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Globex', maxLength: 120, nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  company?: string | null;

  @ApiPropertyOptional({ enum: $Enums.CustomerTier, default: 'STANDARD' })
  @IsOptional()
  @IsEnum($Enums.CustomerTier)
  tier?: $Enums.CustomerTier;
}

/** All fields optional; `company` may be cleared with null, the others may not. */
export class UpdateCustomerDto {
  @ApiPropertyOptional({ maxLength: 254 })
  @IsOptionalNotNull()
  @LowerTrim()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptionalNotNull()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  company?: string | null;

  @ApiPropertyOptional({ enum: $Enums.CustomerTier })
  @IsOptionalNotNull()
  @IsEnum($Enums.CustomerTier)
  tier?: $Enums.CustomerTier;
}

export const CUSTOMER_SORT_FIELDS = ['name', 'createdAt'] as const;
export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

export class ListCustomersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name, email or company (case-insensitive)' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: $Enums.CustomerTier })
  @IsOptional()
  @IsEnum($Enums.CustomerTier)
  tier?: $Enums.CustomerTier;

  @ApiPropertyOptional({ enum: sortOptions(CUSTOMER_SORT_FIELDS), default: 'name' })
  @IsOptional()
  @IsIn(sortOptions(CUSTOMER_SORT_FIELDS))
  sort: string = 'name';
}

export class CustomerDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  company: string | null;

  @ApiProperty({ enum: $Enums.CustomerTier })
  tier: $Enums.CustomerTier;

  @ApiProperty({ description: 'Number of tickets opened by this customer' })
  ticketCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CustomerPageDto {
  @ApiProperty({ type: [CustomerDto] })
  items: CustomerDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

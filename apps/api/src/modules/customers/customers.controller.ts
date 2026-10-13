import {
  Body,
  Controller,
  Delete,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ProblemDetailsDto } from '../../common/http/problem-details.dto';
import { CurrentActor, type Actor } from '../../common/http/actor';
import { CustomersService } from './customers.service';
import { Public, Roles } from '../../common/auth/auth';
import {
  CreateCustomerDto,
  CustomerDto,
  CustomerPageDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

@ApiTags('customers')
@ApiBadRequestResponse({ type: ProblemDetailsDto, description: 'Validation failed' })
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'List customers (search, tier filter, pagination)' })
  @ApiOkResponse({ type: CustomerPageDto })
  list(@Query() query: ListCustomersQueryDto) {
    return this.customers.list(query);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get a customer' })
  @ApiOkResponse({ type: CustomerDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }

  @Post()
  @Roles('MANAGER', 'ADMIN')
  @ApiOperation({ summary: 'Create a customer' })
  @ApiCreatedResponse({ type: CustomerDto })
  @ApiConflictResponse({ type: ProblemDetailsDto, description: 'Email already exists' })
  create(@Body() dto: CreateCustomerDto) {
    return this.customers.create(dto);
  }

  @Patch(':id')
  @Roles('MANAGER', 'ADMIN')
  @ApiOperation({ summary: 'Update a customer' })
  @ApiOkResponse({ type: CustomerDto })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto, description: 'Email already exists' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(id, dto);
  }

  @Delete(':id')
  @Roles('MANAGER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a customer that has no tickets' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  @ApiConflictResponse({ type: ProblemDetailsDto, description: 'Customer has tickets' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() _actor: Actor) {
    return this.customers.remove(id);
  }
}

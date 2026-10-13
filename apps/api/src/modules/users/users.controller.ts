import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/auth';
import { CreateUserDto, UpdateUserDto, UserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List workspace users (administrator only)' })
  @ApiOkResponse({ type: [UserDto] })
  list() {
    return this.users.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a teammate account' })
  @ApiCreatedResponse({ type: UserDto })
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch()
  @ApiOperation({ summary: 'Change a user role or deactivate an account' })
  @ApiOkResponse({ type: UserDto })
  update(@Body() dto: UpdateUserDto) {
    return this.users.update(dto);
  }
}

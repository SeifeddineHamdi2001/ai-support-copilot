import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, type AuthUser } from '../../common/auth/auth';
import { AgentsService } from './agents.service';
import { AgentDto } from './dto/agent.dto';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'List active teammates for ticket assignment' })
  @ApiOkResponse({ type: [AgentDto] })
  list(@CurrentUser() user?: AuthUser): Promise<AgentDto[]> {
    return this.agents.list(user);
  }
}

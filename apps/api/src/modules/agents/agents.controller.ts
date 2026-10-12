import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentsService } from './agents.service';
import { AgentDto } from './dto/agent.dto';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @ApiOperation({ summary: 'List active support agents (assignees and X-User-Id values)' })
  @ApiOkResponse({ type: [AgentDto] })
  list(): Promise<AgentDto[]> {
    return this.agents.list();
  }
}

import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthService } from './health.service';
import { Public } from '../../common/auth/auth';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Liveness + database connectivity check' })
  @ApiOkResponse({ description: 'API and database are up' })
  @ApiServiceUnavailableResponse({ description: 'Database unreachable (Problem Details body)' })
  async check() {
    const result = await this.health.check();
    if (result.db !== 'up') {
      throw new HttpException(
        {
          type: 'https://errors.copilot.local/database-unavailable',
          title: 'Database unavailable',
          status: HttpStatus.SERVICE_UNAVAILABLE,
          detail: 'The API cannot reach the database.',
          errorCode: 'DATABASE_UNAVAILABLE',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return result;
  }
}

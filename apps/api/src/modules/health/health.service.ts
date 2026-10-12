import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AppEnv } from '../../config/env.validation';

export interface HealthResult {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  dbLatencyMs: number;
  providers: { llm: string; embedding: string };
  uptimeSeconds: number;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async check(): Promise<HealthResult> {
    const started = Date.now();
    let db: HealthResult['db'] = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      db = 'down';
      this.logger.error(`Database health check failed: ${(err as Error).message}`);
    }
    return {
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      dbLatencyMs: Date.now() - started,
      providers: {
        llm: this.config.get('LLM_PROVIDER', { infer: true }),
        embedding: this.config.get('EMBEDDING_PROVIDER', { infer: true }),
      },
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { validateEnv, type AppEnv } from './config/env.validation';
import { AgentsModule } from './modules/agents/agents.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DraftsModule } from './modules/drafts/drafts.module';
import { EscalationModule } from './modules/escalation/escalation.module';
import { HealthModule } from './modules/health/health.module';
import { KbModule } from './modules/kb/kb.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Local dev reads the repo-root .env; in Docker the variables come from compose.
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    // Limits only the routes decorated with @AiRateLimited() (LLM and embedding calls).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => ({
        throttlers: [{ ttl: 60_000, limit: config.get('AI_RATE_LIMIT', { infer: true }) }],
      }),
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    AgentsModule,
    UsersModule,
    CustomersModule,
    TicketsModule,
    KbModule,
    DraftsModule,
    EscalationModule,
  ],
})
export class AppModule {}

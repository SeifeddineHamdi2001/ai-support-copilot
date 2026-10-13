import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { EscalationModule } from '../escalation/escalation.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [AiModule, EscalationModule],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}

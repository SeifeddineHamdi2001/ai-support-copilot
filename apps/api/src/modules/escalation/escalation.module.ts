import { Module } from '@nestjs/common';
import { EscalationController } from './escalation.controller';
import { EscalationService } from './escalation.service';

/** Rules-based escalation recommendations. Tickets and drafts call it after each AI step. */
@Module({
  controllers: [EscalationController],
  providers: [EscalationService],
  exports: [EscalationService],
})
export class EscalationModule {}

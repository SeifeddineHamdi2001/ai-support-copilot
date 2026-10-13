import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { EscalationModule } from '../escalation/escalation.module';
import { KbModule } from '../kb/kb.module';
import { DraftsController } from './drafts.controller';
import { DraftsService } from './drafts.service';

@Module({
  imports: [AiModule, KbModule, EscalationModule],
  controllers: [DraftsController],
  providers: [DraftsService],
})
export class DraftsModule {}

import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { KbSearchService } from './kb-search.service';
import { KbController } from './kb.controller';
import { KbService } from './kb.service';

@Module({
  imports: [AiModule],
  controllers: [KbController],
  providers: [KbService, KbSearchService],
  exports: [KbSearchService],
})
export class KbModule {}

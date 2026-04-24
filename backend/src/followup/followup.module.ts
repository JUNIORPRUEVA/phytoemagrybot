import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BotConfigModule } from '../bot-config/bot-config.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { ClientConfigModule } from '../config/config.module';
import { MemoryModule } from '../memory/memory.module';
import { FollowupService } from './followup.service';

@Module({
  imports: [AiModule, BotConfigModule, CompanyContextModule, ClientConfigModule, MemoryModule],
  providers: [FollowupService],
  exports: [FollowupService],
})
export class FollowupModule {}
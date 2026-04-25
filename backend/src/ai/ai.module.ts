import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { BotConfigModule } from '../bot-config/bot-config.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PromptTransformEngine } from './prompt-transform.engine';

@Module({
  imports: [BotModule, BotConfigModule],
  controllers: [AiController],
  providers: [AiService, PromptTransformEngine],
  exports: [AiService],
})
export class AiModule {}
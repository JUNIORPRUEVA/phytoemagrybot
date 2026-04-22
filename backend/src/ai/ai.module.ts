import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { BotConfigModule } from '../bot-config/bot-config.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [BotModule, BotConfigModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
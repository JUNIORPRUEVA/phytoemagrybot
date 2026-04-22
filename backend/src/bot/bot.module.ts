import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ClientConfigModule } from '../config/config.module';
import { MemoryModule } from '../memory/memory.module';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';

@Module({
  imports: [forwardRef(() => AiModule), ClientConfigModule, MemoryModule],
  controllers: [BotController],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
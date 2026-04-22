import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BotConfigModule } from '../bot-config/bot-config.module';
import { ClientConfigModule } from '../config/config.module';
import { MediaModule } from '../media/media.module';
import { MemoryModule } from '../memory/memory.module';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';

@Module({
  imports: [
    forwardRef(() => AiModule),
    ClientConfigModule,
    BotConfigModule,
    MemoryModule,
    MediaModule,
  ],
  controllers: [BotController],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
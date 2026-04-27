import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BotConfigModule } from '../bot-config/bot-config.module';
import { CompanyContextModule } from '../company-context/company-context.module';
import { ClientConfigModule } from '../config/config.module';
import { MemoryModule } from '../memory/memory.module';
import { ToolsModule } from '../tools/tools.module';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';

@Module({
  imports: [
    forwardRef(() => AiModule),
    ClientConfigModule,
    BotConfigModule,
    CompanyContextModule,
    MemoryModule,
    ToolsModule,
  ],
  controllers: [BotController],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
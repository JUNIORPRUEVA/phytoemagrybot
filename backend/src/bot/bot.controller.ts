import { Body, Controller, Post } from '@nestjs/common';
import { ProcessIncomingMessageDto } from './dto/process-incoming-message.dto';
import { BotService } from './bot.service';

@Controller('bot')
export class BotController {
  constructor(private readonly botService: BotService) {}

  @Post('process')
  process(@Body() dto: ProcessIncomingMessageDto) {
    return this.botService.processIncomingMessage(dto.contactId, dto.message);
  }

  @Post('run-tests')
  runTests() {
    return this.botService.runBotTests();
  }
}
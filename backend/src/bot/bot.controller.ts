import { Body, Controller, Post, Req } from '@nestjs/common';
import { ProcessIncomingMessageDto } from './dto/process-incoming-message.dto';
import { BotService } from './bot.service';
import { AuthenticatedRequest } from '../auth/auth.types';

@Controller('bot')
export class BotController {
  constructor(private readonly botService: BotService) {}

  @Post('process')
  process(@Req() req: AuthenticatedRequest, @Body() dto: ProcessIncomingMessageDto) {
    return this.botService.processIncomingMessage(dto.contactId, dto.message, req.user!.activeCompanyId);
  }

  @Post('run-tests')
  runTests() {
    return this.botService.runBotTests();
  }
}

import { Body, Controller, Post, Req } from '@nestjs/common';
import { BotService } from '../bot/bot.service';
import { ProcessIncomingMessageDto } from '../bot/dto/process-incoming-message.dto';
import { AuthenticatedRequest } from '../auth/auth.types';

@Controller('ai')
export class AiController {
  constructor(private readonly botService: BotService) {}

  @Post('test')
  async test(@Req() req: AuthenticatedRequest, @Body() dto: ProcessIncomingMessageDto) {
    return this.botService.processIncomingMessage(dto.contactId, dto.message, req.user!.activeCompanyId);
  }
}
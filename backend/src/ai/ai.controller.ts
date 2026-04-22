import { Body, Controller, Post } from '@nestjs/common';
import { BotService } from '../bot/bot.service';
import { ProcessIncomingMessageDto } from '../bot/dto/process-incoming-message.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly botService: BotService) {}

  @Post('test')
  async test(@Body() dto: ProcessIncomingMessageDto) {
    return this.botService.processIncomingMessage(dto.contactId, dto.message);
  }
}
import { Body, Controller, Headers, Post } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  @Post('whatsapp')
  handleWhatsAppWebhook(
    @Body() payload: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.whatsAppService.handleWebhook(payload, headers);
  }
}
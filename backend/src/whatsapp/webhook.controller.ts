import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { WhatsAppService } from './whatsapp.service';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  @Post('whatsapp')
  @Public()
  handleWhatsAppWebhook(
    @Body() payload: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.whatsAppService.acceptWebhook(payload, headers);
  }
}
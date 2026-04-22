import { Controller, Get, Post } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';

@Controller('whatsapp/channel')
export class WhatsAppChannelController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  @Get()
  getChannelStatus() {
    return this.whatsAppService.getChannelStatus();
  }

  @Post('instance')
  createChannelInstance() {
    return this.whatsAppService.createChannelInstance();
  }

  @Post('qr')
  refreshChannelQr() {
    return this.whatsAppService.refreshChannelQr();
  }
}
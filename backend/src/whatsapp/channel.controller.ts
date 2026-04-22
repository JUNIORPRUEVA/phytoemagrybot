import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { SetWebhookDto } from './dto/set-webhook.dto';
import { WhatsAppService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsAppChannelController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  @Post('create')
  createInstance(@Body() body: CreateInstanceDto) {
    return this.whatsAppService.createInstance(body.instanceName);
  }

  @Get('qr/:instanceName')
  getQr(@Param('instanceName') instanceName: string) {
    return this.whatsAppService.getQr(instanceName);
  }

  @Post('webhook/:instanceName')
  setWebhook(
    @Param('instanceName') instanceName: string,
    @Body() body: SetWebhookDto,
  ) {
    return this.whatsAppService.setWebhook(instanceName, body.webhook, body.events);
  }

  @Get('status/:instanceName')
  getStatus(@Param('instanceName') instanceName: string) {
    return this.whatsAppService.getStatus(instanceName);
  }
}
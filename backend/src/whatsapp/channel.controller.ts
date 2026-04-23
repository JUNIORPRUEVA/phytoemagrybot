import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { SetWebhookDto } from './dto/set-webhook.dto';
import { UpdateInstanceDto } from './dto/update-instance.dto';
import { WhatsAppService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsAppChannelController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  @Post('create')
  createInstance(@Body() body: CreateInstanceDto) {
    return this.whatsAppService.createInstance(body.instanceName, {
      phone: body.phone,
    });
  }

  @Get('list')
  getInstances() {
    return this.whatsAppService.getInstances();
  }

  @Get('qr/:name')
  getQr(@Param('name') name: string) {
    return this.whatsAppService.connectInstance(name);
  }

  @Get('status/:name')
  getStatus(@Param('name') name: string) {
    return this.whatsAppService.getInstanceStatus(name);
  }

  @Delete('delete/:name')
  deleteInstance(@Param('name') name: string) {
    return this.whatsAppService.deleteInstance(name);
  }

  @Patch('instance/:name')
  updateInstance(
    @Param('name') name: string,
    @Body() body: UpdateInstanceDto,
  ) {
    return this.whatsAppService.updateInstanceMetadata(name, body);
  }

  @Post('webhook/:name')
  setWebhook(
    @Param('name') name: string,
    @Body() body: SetWebhookDto,
  ) {
    return this.whatsAppService.setWebhook(name, body.webhook, body.events);
  }
}
import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { SetWebhookDto } from './dto/set-webhook.dto';
import { UpdateInstanceDto } from './dto/update-instance.dto';
import { WhatsAppService } from './whatsapp.service';
import { AuthenticatedRequest } from '../auth/auth.types';

@Controller('whatsapp')
export class WhatsAppChannelController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  @Post('create')
  createInstance(@Req() req: AuthenticatedRequest, @Body() body: CreateInstanceDto) {
    return this.whatsAppService.createInstance(
      body.instanceName,
      { phone: body.phone },
      req.user!.activeCompanyId,
    );
  }

  @Get('list')
  getInstances(@Req() req: AuthenticatedRequest) {
    return this.whatsAppService.getInstances(req.user!.activeCompanyId);
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

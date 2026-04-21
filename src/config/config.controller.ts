import { Body, Controller, Get, Post } from '@nestjs/common';
import { ClientConfigService } from './config.service';
import { SaveConfigDto } from './dto/create-client.dto';

@Controller('config')
export class ClientConfigController {
  constructor(private readonly clientConfigService: ClientConfigService) {}

  @Get()
  getConfig() {
    return this.clientConfigService.getConfig();
  }

  @Post()
  saveConfig(@Body() dto: SaveConfigDto) {
    return this.clientConfigService.saveConfig(dto);
  }
}
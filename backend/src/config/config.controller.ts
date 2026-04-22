import { Body, Controller, Get, Post } from '@nestjs/common';
import { ClientConfigService } from './config.service';
import { SaveConfigDto } from './dto/save-config.dto';

@Controller('config')
export class ClientConfigController {
  constructor(private readonly clientConfigService: ClientConfigService) {}

  @Get()
  async getConfig() {
    const config = await this.clientConfigService.getConfig();
    return this.clientConfigService.toPublicConfig(config);
  }

  @Post()
  async saveConfig(@Body() dto: SaveConfigDto) {
    const config = await this.clientConfigService.saveConfig(dto);
    return this.clientConfigService.toPublicConfig(config);
  }
}
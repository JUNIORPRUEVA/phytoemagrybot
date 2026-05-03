import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ClientConfigService } from './config.service';
import { SaveConfigDto } from './dto/save-config.dto';
import { AuthenticatedRequest } from '../auth/auth.types';

@Controller('config')
export class ClientConfigController {
  constructor(private readonly clientConfigService: ClientConfigService) {}

  @Get()
  async getConfig(@Req() req: AuthenticatedRequest) {
    const config = await this.clientConfigService.getConfig(req.user!.activeCompanyId);
    return this.clientConfigService.toPublicConfig(config);
  }

  @Post()
  async saveConfig(@Req() req: AuthenticatedRequest, @Body() dto: SaveConfigDto) {
    const config = await this.clientConfigService.saveConfig(dto, req.user!.activeCompanyId);
    return this.clientConfigService.toPublicConfig(config);
  }
}

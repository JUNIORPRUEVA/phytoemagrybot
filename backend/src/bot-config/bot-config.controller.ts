import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { SaveBotConfigDto } from './dto/save-bot-config.dto';
import { BotConfigService } from './bot-config.service';
import { AuthenticatedRequest } from '../auth/auth.types';

@Controller('bot-config')
export class BotConfigController {
  constructor(private readonly botConfigService: BotConfigService) {}

  @Get()
  async getConfig(@Req() req: AuthenticatedRequest) {
    return this.botConfigService.getConfig(req.user!.activeCompanyId);
  }

  @Post()
  async saveConfig(@Req() req: AuthenticatedRequest, @Body() dto: SaveBotConfigDto) {
    return this.botConfigService.saveConfig(dto, req.user!.activeCompanyId);
  }
}

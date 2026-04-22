import { Body, Controller, Get, Post } from '@nestjs/common';
import { SaveBotConfigDto } from './dto/save-bot-config.dto';
import { BotConfigService } from './bot-config.service';

@Controller('bot-config')
export class BotConfigController {
  constructor(private readonly botConfigService: BotConfigService) {}

  @Get()
  async getConfig() {
    return this.botConfigService.getConfig();
  }

  @Post()
  async saveConfig(@Body() dto: SaveBotConfigDto) {
    return this.botConfigService.saveConfig(dto);
  }
}
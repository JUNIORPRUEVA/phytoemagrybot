import { Injectable, OnModuleInit } from '@nestjs/common';
import { BotConfig } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveBotConfigDto } from './dto/save-bot-config.dto';
import { BotConfigRecord, DEFAULT_BOT_PROMPT_CONFIG } from './bot-config.types';

@Injectable()
export class BotConfigService implements OnModuleInit {
  private static readonly CONFIG_ID = 1;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureConfig();
  }

  async getConfig(): Promise<BotConfigRecord> {
    return this.ensureConfig();
  }

  async saveConfig(data: SaveBotConfigDto): Promise<BotConfigRecord> {
    const current = await this.ensureConfig();

    return this.prisma.botConfig.upsert({
      where: { id: BotConfigService.CONFIG_ID },
      create: {
        id: BotConfigService.CONFIG_ID,
        promptBase: data.promptBase?.trim() || current.promptBase,
        promptShort: data.promptShort?.trim() || current.promptShort,
        promptHuman: data.promptHuman?.trim() || current.promptHuman,
        promptSales: data.promptSales?.trim() || current.promptSales,
      },
      update: {
        promptBase: data.promptBase?.trim() || current.promptBase,
        promptShort: data.promptShort?.trim() || current.promptShort,
        promptHuman: data.promptHuman?.trim() || current.promptHuman,
        promptSales: data.promptSales?.trim() || current.promptSales,
      },
    });
  }

  getFullPrompt(config: Pick<BotConfig, 'promptBase' | 'promptShort' | 'promptHuman' | 'promptSales'>): string {
    return [config.promptBase, config.promptShort, config.promptHuman, config.promptSales]
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .join('\n\n');
  }

  private ensureConfig(): Promise<BotConfigRecord> {
    return this.prisma.botConfig.upsert({
      where: { id: BotConfigService.CONFIG_ID },
      create: {
        id: BotConfigService.CONFIG_ID,
        ...DEFAULT_BOT_PROMPT_CONFIG,
      },
      update: {},
    });
  }
}
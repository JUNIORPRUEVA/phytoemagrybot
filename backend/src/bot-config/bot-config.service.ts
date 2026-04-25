import { Injectable, OnModuleInit } from '@nestjs/common';
import { BotConfig } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SaveBotConfigDto } from './dto/save-bot-config.dto';
import {
  BotConfigRecord,
  DEFAULT_BOT_PROMPT_CONFIG,
  LEGACY_BOT_PROMPT_CONFIGS,
} from './bot-config.types';

@Injectable()
export class BotConfigService implements OnModuleInit {
  private static readonly CONFIG_ID = 1;
  private static readonly KNOWLEDGE_CONTEXT_CACHE_KEY = 'bot:knowledge-context:v1';
  private static readonly LEGACY_KNOWLEDGE_CONTEXT_CACHE_KEY = 'bot:knowledge-context:v2';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureConfig();
  }

  async getConfig(): Promise<BotConfigRecord> {
    return this.ensureConfig();
  }

  async saveConfig(data: SaveBotConfigDto): Promise<BotConfigRecord> {
    const current = await this.ensureConfig();

    const config = await this.prisma.botConfig.upsert({
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

    await this.redisService.deleteMany([
      BotConfigService.KNOWLEDGE_CONTEXT_CACHE_KEY,
      BotConfigService.LEGACY_KNOWLEDGE_CONTEXT_CACHE_KEY,
    ]);
    return config;
  }

  getFullPrompt(config: Pick<BotConfig, 'promptBase' | 'promptShort' | 'promptHuman' | 'promptSales'>): string {
    return [config.promptBase, config.promptShort, config.promptHuman, config.promptSales]
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .join('\n\n');
  }

  private async ensureConfig(): Promise<BotConfigRecord> {
    const config = await this.prisma.botConfig.upsert({
      where: { id: BotConfigService.CONFIG_ID },
      create: {
        id: BotConfigService.CONFIG_ID,
        ...DEFAULT_BOT_PROMPT_CONFIG,
      },
      update: {},
    });

    if (!this.shouldSyncToBundledDefaults(config)) {
      return config;
    }

    const synced = await this.prisma.botConfig.update({
      where: { id: BotConfigService.CONFIG_ID },
      data: {
        ...DEFAULT_BOT_PROMPT_CONFIG,
      },
    });

    await this.redisService.deleteMany([
      BotConfigService.KNOWLEDGE_CONTEXT_CACHE_KEY,
      BotConfigService.LEGACY_KNOWLEDGE_CONTEXT_CACHE_KEY,
    ]);
    return synced;
  }

  private shouldSyncToBundledDefaults(config: BotConfigRecord): boolean {
    const fields = [config.promptBase, config.promptShort, config.promptHuman, config.promptSales].map(
      (value) => value.trim(),
    );

    if (fields.every((value) => value.length === 0)) {
      return true;
    }

    return LEGACY_BOT_PROMPT_CONFIGS.some((legacy) => {
      return (
        config.promptBase.trim() === legacy.promptBase &&
        config.promptShort.trim() === legacy.promptShort &&
        config.promptHuman.trim() === legacy.promptHuman &&
        config.promptSales.trim() === legacy.promptSales
      );
    });
  }
}
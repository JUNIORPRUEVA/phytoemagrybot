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
  private static readonly KNOWLEDGE_CONTEXT_CACHE_KEY_PREFIX = 'bot:knowledge-context:v1';
  private static readonly LEGACY_KNOWLEDGE_CONTEXT_CACHE_KEY_PREFIX = 'bot:knowledge-context:v2';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    // No-op: per-company seeding is done when a company is created
  }

  async getConfig(companyId: string): Promise<BotConfigRecord> {
    return this.ensureConfig(companyId);
  }

  async saveConfig(data: SaveBotConfigDto, companyId: string): Promise<BotConfigRecord> {
    const current = await this.ensureConfig(companyId);

    const config = await this.prisma.botConfig.upsert({
      where: { companyId },
      create: {
        companyId,
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
      `${BotConfigService.KNOWLEDGE_CONTEXT_CACHE_KEY_PREFIX}:${companyId}`,
      `${BotConfigService.LEGACY_KNOWLEDGE_CONTEXT_CACHE_KEY_PREFIX}:${companyId}`,
    ]);
    return config;
  }

  getFullPrompt(config: Pick<BotConfig, 'promptBase' | 'promptShort' | 'promptHuman' | 'promptSales'>): string {
    return [config.promptBase, config.promptShort, config.promptHuman, config.promptSales]
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .join('\n\n');
  }

  private async ensureConfig(companyId: string): Promise<BotConfigRecord> {
    const config = await this.prisma.botConfig.upsert({
      where: { companyId },
      create: {
        companyId,
        ...DEFAULT_BOT_PROMPT_CONFIG,
      },
      update: {},
    });

    if (!this.shouldSyncToBundledDefaults(config)) {
      return config;
    }

    const synced = await this.prisma.botConfig.update({
      where: { companyId },
      data: {
        ...DEFAULT_BOT_PROMPT_CONFIG,
      },
    });

    await this.redisService.deleteMany([
      `${BotConfigService.KNOWLEDGE_CONTEXT_CACHE_KEY_PREFIX}:${companyId}`,
      `${BotConfigService.LEGACY_KNOWLEDGE_CONTEXT_CACHE_KEY_PREFIX}:${companyId}`,
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
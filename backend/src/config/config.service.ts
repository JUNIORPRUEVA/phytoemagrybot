import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { AiSettings, BotSettings, Config, Prisma, WhatsAppSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveConfigDto } from './dto/save-config.dto';
import { AppConfigRecord } from './config.types';

@Injectable()
export class ClientConfigService {
  private static readonly CONFIG_ID = 1;
  private static readonly DEFAULT_WHATSAPP_WEBHOOK_URL =
    'https://ai-business-platform-phytoemagrybot-backend.onqyr1.easypanel.host/webhook/whatsapp';
  private static readonly LEGACY_N8N_WEBHOOK_URL =
    'https://n8n-n8n.gcdndd.easypanel.host/webhook/7e488a8b-fc78-4702-bbf4-8159f7ca094e';
  private static readonly DEFAULT_PROMPT =
    'Eres un asistente profesional de WhatsApp. Responde con claridad, foco comercial y tono amable.';
  private static readonly DEFAULT_AI_MODEL = 'gpt-4o-mini';
  private static readonly DEFAULT_AI_TEMPERATURE = 0.4;
  private static readonly DEFAULT_AI_MAX_TOKENS = 180;
  private static readonly DEFAULT_MEMORY_WINDOW = 6;
  private static readonly DEFAULT_RESPONSE_CACHE_TTL_SECONDS = 60;
  private static readonly DEFAULT_SPAM_GROUP_WINDOW_MS = 2000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: NestConfigService,
  ) {}

  async getConfig(): Promise<AppConfigRecord> {
    const config = await this.prisma.config.upsert({
      where: { id: ClientConfigService.CONFIG_ID },
      create: {
        id: ClientConfigService.CONFIG_ID,
        openaiKey: '',
        promptBase: ClientConfigService.DEFAULT_PROMPT,
        configurations: {} as Prisma.InputJsonValue,
      },
      update: {},
    });

    const syncedConfig = await this.syncStructuredSettings(config);
    return this.applyEnvironmentFallbacks(syncedConfig);
  }

  async saveConfig(data: SaveConfigDto): Promise<AppConfigRecord> {
    const current = await this.getStoredConfig();
    const mergedConfigurations = this.mergeRecords(
      this.asRecord(current.configurations),
      this.asRecord(data.configurations),
    );

    const config = await this.prisma.config.upsert({
      where: { id: ClientConfigService.CONFIG_ID },
      create: {
        id: ClientConfigService.CONFIG_ID,
        openaiKey: data.openaiKey?.trim() ?? current.openaiKey,
        elevenlabsKey: data.elevenlabsKey?.trim() || current.elevenlabsKey || null,
        promptBase:
          data.promptBase?.trim() ||
          current.promptBase ||
          ClientConfigService.DEFAULT_PROMPT,
        configurations: mergedConfigurations as Prisma.InputJsonValue,
      },
      update: {
        openaiKey: data.openaiKey?.trim() ?? current.openaiKey,
        elevenlabsKey: data.elevenlabsKey?.trim() || current.elevenlabsKey || null,
        promptBase:
          data.promptBase?.trim() ||
          current.promptBase ||
          ClientConfigService.DEFAULT_PROMPT,
        configurations: mergedConfigurations as Prisma.InputJsonValue,
      },
    });

    const syncedConfig = await this.syncStructuredSettings(config, mergedConfigurations);
    return this.applyEnvironmentFallbacks(syncedConfig);
  }

  toPublicConfig(config: AppConfigRecord) {
    const effectiveConfig = this.applyEnvironmentFallbacks(config);

    return {
      id: effectiveConfig.id,
      promptBase: effectiveConfig.promptBase,
      configurations: this.buildConfigurations(
        this.asRecord(effectiveConfig.configurations),
        effectiveConfig.aiSettings,
        effectiveConfig.botSettings,
        effectiveConfig.whatsappSettings,
      ),
      openaiConfigured: Boolean(effectiveConfig.openaiKey.trim()),
      elevenlabsConfigured: Boolean(effectiveConfig.elevenlabsKey?.trim()),
    };
  }

  private async getStoredConfig(): Promise<AppConfigRecord> {
    const config = await this.prisma.config.upsert({
      where: { id: ClientConfigService.CONFIG_ID },
      create: {
        id: ClientConfigService.CONFIG_ID,
        openaiKey: '',
        promptBase: ClientConfigService.DEFAULT_PROMPT,
        configurations: {} as Prisma.InputJsonValue,
      },
      update: {},
    });

    return this.syncStructuredSettings(config);
  }

  private async syncStructuredSettings(
    config: Config,
    inputConfigurations?: Record<string, unknown>,
  ): Promise<AppConfigRecord> {
    const baseConfigurations = this.mergeRecords(
      this.asRecord(config.configurations),
      inputConfigurations ?? {},
    );
    const aiConfig = this.asRecord(baseConfigurations.ai);
    const botConfig = this.asRecord(baseConfigurations.bot);
    const whatsappConfig = this.asRecord(baseConfigurations.whatsapp);
    const elevenlabsConfig = this.asRecord(baseConfigurations.elevenlabs);

    const [aiSettings, botSettings, whatsappSettings] = await this.prisma.$transaction([
      this.prisma.aiSettings.upsert({
        where: { configId: config.id },
        create: {
          configId: config.id,
          modelName:
            this.asString(aiConfig.modelName) || ClientConfigService.DEFAULT_AI_MODEL,
          temperature: this.asNumber(
            aiConfig.temperature,
            ClientConfigService.DEFAULT_AI_TEMPERATURE,
          ),
          maxCompletionTokens: this.asInteger(
            aiConfig.maxCompletionTokens,
            ClientConfigService.DEFAULT_AI_MAX_TOKENS,
          ),
          memoryWindow: this.asInteger(
            aiConfig.memoryWindow,
            ClientConfigService.DEFAULT_MEMORY_WINDOW,
          ),
        },
        update: {
          modelName:
            this.asString(aiConfig.modelName) || ClientConfigService.DEFAULT_AI_MODEL,
          temperature: this.asNumber(
            aiConfig.temperature,
            ClientConfigService.DEFAULT_AI_TEMPERATURE,
          ),
          maxCompletionTokens: this.asInteger(
            aiConfig.maxCompletionTokens,
            ClientConfigService.DEFAULT_AI_MAX_TOKENS,
          ),
          memoryWindow: this.asInteger(
            aiConfig.memoryWindow,
            ClientConfigService.DEFAULT_MEMORY_WINDOW,
          ),
        },
      }),
      this.prisma.botSettings.upsert({
        where: { configId: config.id },
        create: {
          configId: config.id,
          responseCacheTtlSeconds: this.asInteger(
            botConfig.responseCacheTtlSeconds,
            ClientConfigService.DEFAULT_RESPONSE_CACHE_TTL_SECONDS,
          ),
          spamGroupWindowMs: this.asInteger(
            botConfig.spamGroupWindowMs,
            ClientConfigService.DEFAULT_SPAM_GROUP_WINDOW_MS,
          ),
          allowAudioReplies: this.asBoolean(botConfig.allowAudioReplies, true),
        },
        update: {
          responseCacheTtlSeconds: this.asInteger(
            botConfig.responseCacheTtlSeconds,
            ClientConfigService.DEFAULT_RESPONSE_CACHE_TTL_SECONDS,
          ),
          spamGroupWindowMs: this.asInteger(
            botConfig.spamGroupWindowMs,
            ClientConfigService.DEFAULT_SPAM_GROUP_WINDOW_MS,
          ),
          allowAudioReplies: this.asBoolean(botConfig.allowAudioReplies, true),
        },
      }),
      this.prisma.whatsAppSettings.upsert({
        where: { configId: config.id },
        create: {
          configId: config.id,
          webhookSecret: this.asString(whatsappConfig.webhookSecret),
          apiBaseUrl: this.asString(whatsappConfig.apiBaseUrl),
          apiKey: this.asString(whatsappConfig.apiKey),
          instanceName: this.asString(whatsappConfig.instanceName),
          fallbackMessage: this.asNullableString(whatsappConfig.fallbackMessage),
          audioVoiceId: this.asNullableString(whatsappConfig.audioVoiceId),
          elevenLabsBaseUrl: this.asNullableString(elevenlabsConfig.baseUrl),
        },
        update: {
          webhookSecret: this.asString(whatsappConfig.webhookSecret),
          apiBaseUrl: this.asString(whatsappConfig.apiBaseUrl),
          apiKey: this.asString(whatsappConfig.apiKey),
          instanceName: this.asString(whatsappConfig.instanceName),
          fallbackMessage: this.asNullableString(whatsappConfig.fallbackMessage),
          audioVoiceId: this.asNullableString(whatsappConfig.audioVoiceId),
          elevenLabsBaseUrl: this.asNullableString(elevenlabsConfig.baseUrl),
        },
      }),
    ]);

    const persistedConfigurations = this.buildConfigurations(
      baseConfigurations,
      aiSettings,
      botSettings,
      whatsappSettings,
    );

    const nextConfig = await this.prisma.config.update({
      where: { id: config.id },
      data: {
        configurations: persistedConfigurations as Prisma.InputJsonValue,
      },
    });

    return {
      ...nextConfig,
      aiSettings,
      botSettings,
      whatsappSettings,
    };
  }

  private buildConfigurations(
    base: Record<string, unknown>,
    aiSettings: AiSettings | null,
    botSettings: BotSettings | null,
    whatsappSettings: WhatsAppSettings | null,
  ): Record<string, unknown> {
    const next = { ...base };
    const ai = { ...this.asRecord(base.ai) };
    const bot = { ...this.asRecord(base.bot) };
    const whatsapp = { ...this.asRecord(base.whatsapp) };
    const elevenlabs = { ...this.asRecord(base.elevenlabs) };

    if (aiSettings) {
      ai.modelName = aiSettings.modelName;
      ai.temperature = aiSettings.temperature;
      ai.maxCompletionTokens = aiSettings.maxCompletionTokens;
      ai.memoryWindow = aiSettings.memoryWindow;
    }

    if (botSettings) {
      bot.responseCacheTtlSeconds = botSettings.responseCacheTtlSeconds;
      bot.spamGroupWindowMs = botSettings.spamGroupWindowMs;
      bot.allowAudioReplies = botSettings.allowAudioReplies;
    }

    if (whatsappSettings) {
      whatsapp.webhookSecret = whatsappSettings.webhookSecret;
      whatsapp.apiBaseUrl = whatsappSettings.apiBaseUrl;
      whatsapp.apiKey = whatsappSettings.apiKey;
      whatsapp.instanceName = whatsappSettings.instanceName;

      if (whatsappSettings.fallbackMessage) {
        whatsapp.fallbackMessage = whatsappSettings.fallbackMessage;
      }

      if (whatsappSettings.audioVoiceId) {
        whatsapp.audioVoiceId = whatsappSettings.audioVoiceId;
      }

      if (whatsappSettings.elevenLabsBaseUrl) {
        elevenlabs.baseUrl = whatsappSettings.elevenLabsBaseUrl;
      }
    }

    next.ai = ai;
    next.bot = bot;
    next.whatsapp = whatsapp;
    next.elevenlabs = elevenlabs;

    return next;
  }

  private applyEnvironmentFallbacks(config: AppConfigRecord): AppConfigRecord {
    const configurations = this.asRecord(config.configurations);
    const whatsapp = this.asRecord(configurations.whatsapp);
    const elevenlabs = this.asRecord(configurations.elevenlabs);
    const envOpenAiKey = this.readEnv('OPENAI_API_KEY');
    const envElevenLabsKey = this.readEnv('ELEVENLABS_API_KEY');
    const envElevenLabsBaseUrl = this.readEnv('ELEVENLABS_BASE_URL');
    const envElevenLabsVoiceId = this.readEnv('ELEVENLABS_VOICE_ID');
    const envEvolutionUrl = this.readEnv('EVOLUTION_URL');
    const envEvolutionKey = this.readEnv('AUTHENTICATION_API_KEY');
    const envEvolutionInstanceName = this.readEnv('EVOLUTION_INSTANCE_NAME');
    const envWebhookUrl = this.readEnv('WEBHOOK_URL');
    const envWebhookSecret = this.readEnv('WEBHOOK_SECRET');
    const envBotEnableAudio = this.readEnv('BOT_ENABLE_AUDIO');
    const persistedWebhookUrl = this.normalizeWebhookUrl(
      this.asString(whatsapp['webhookUrl']) || envWebhookUrl,
    );

    const nextConfigurations = this.mergeRecords(configurations, {
      bot: {
        allowAudioReplies: this.asBoolean(envBotEnableAudio, true),
      },
      whatsapp: {
        apiBaseUrl: this.asString(whatsapp['apiBaseUrl']) || envEvolutionUrl,
        apiKey: this.asString(whatsapp['apiKey']) || envEvolutionKey,
        instanceName: this.asString(whatsapp['instanceName']) || envEvolutionInstanceName,
        audioVoiceId: whatsapp['audioVoiceId'] || envElevenLabsVoiceId,
        webhookUrl: persistedWebhookUrl,
        webhookSecret: this.asString(whatsapp['webhookSecret']) || envWebhookSecret,
      },
      elevenlabs: {
        baseUrl: elevenlabs['baseUrl'] || envElevenLabsBaseUrl,
      },
    });

    return {
      ...config,
      openaiKey: config.openaiKey.trim() || envOpenAiKey,
      elevenlabsKey: config.elevenlabsKey?.trim() || envElevenLabsKey || null,
      configurations: nextConfigurations as Prisma.JsonValue,
      whatsappSettings: config.whatsappSettings
        ? {
            ...config.whatsappSettings,
            apiBaseUrl: config.whatsappSettings.apiBaseUrl || envEvolutionUrl,
            apiKey: config.whatsappSettings.apiKey || envEvolutionKey,
            instanceName:
              config.whatsappSettings.instanceName || envEvolutionInstanceName,
            audioVoiceId: config.whatsappSettings.audioVoiceId || envElevenLabsVoiceId,
            elevenLabsBaseUrl:
              config.whatsappSettings.elevenLabsBaseUrl || envElevenLabsBaseUrl,
            webhookSecret: config.whatsappSettings.webhookSecret || envWebhookSecret,
          }
        : config.whatsappSettings,
      botSettings: config.botSettings
        ? {
            ...config.botSettings,
            allowAudioReplies: this.asBoolean(envBotEnableAudio, config.botSettings.allowAudioReplies),
          }
        : config.botSettings,
    };
  }

  private normalizeWebhookUrl(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
      return normalized;
    }

    if (normalized === ClientConfigService.LEGACY_N8N_WEBHOOK_URL) {
      return ClientConfigService.DEFAULT_WHATSAPP_WEBHOOK_URL;
    }

    return normalized;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private mergeRecords(
    base: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): Record<string, unknown> {
    const next: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(incoming)) {
      if (this.isPlainObject(next[key]) && this.isPlainObject(value)) {
        next[key] = this.mergeRecords(
          next[key] as Record<string, unknown>,
          value as Record<string, unknown>,
        );
        continue;
      }

      next[key] = value;
    }

    return next;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asNullableString(value: unknown): string | null {
    const next = this.asString(value);
    return next || null;
  }

  private asNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return fallback;
  }

  private asInteger(value: unknown, fallback: number): number {
    return Math.max(1, Math.trunc(this.asNumber(value, fallback)));
  }

  private asBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }

    return fallback;
  }

  private readEnv(name: string): string {
    return this.configService.get<string>(name)?.trim() || '';
  }
}
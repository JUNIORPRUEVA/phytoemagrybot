import { Injectable } from '@nestjs/common';
import { Config, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveConfigDto } from './dto/save-config.dto';

@Injectable()
export class ClientConfigService {
  private static readonly CONFIG_ID = 1;
  private static readonly DEFAULT_PROMPT =
    'Eres un asistente profesional de WhatsApp. Responde con claridad, foco comercial y tono amable.';

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<Config> {
    return this.prisma.config.upsert({
      where: { id: ClientConfigService.CONFIG_ID },
      create: {
        id: ClientConfigService.CONFIG_ID,
        openaiKey: '',
        promptBase: ClientConfigService.DEFAULT_PROMPT,
        configurations: {} as Prisma.InputJsonValue,
      },
      update: {},
    });
  }

  async saveConfig(data: SaveConfigDto): Promise<Config> {
    const current = await this.getConfig();

    const nextConfigurations =
      data.configurations !== undefined
        ? (data.configurations as Prisma.InputJsonValue)
        : (current.configurations as Prisma.InputJsonValue | undefined);

    return this.prisma.config.upsert({
      where: { id: ClientConfigService.CONFIG_ID },
      create: {
        id: ClientConfigService.CONFIG_ID,
        openaiKey: data.openaiKey?.trim() ?? current.openaiKey,
        elevenlabsKey: data.elevenlabsKey?.trim() || current.elevenlabsKey || null,
        promptBase:
          data.promptBase?.trim() ||
          current.promptBase ||
          ClientConfigService.DEFAULT_PROMPT,
        configurations: nextConfigurations,
      },
      update: {
        openaiKey: data.openaiKey?.trim() ?? current.openaiKey,
        elevenlabsKey: data.elevenlabsKey?.trim() || current.elevenlabsKey || null,
        promptBase:
          data.promptBase?.trim() ||
          current.promptBase ||
          ClientConfigService.DEFAULT_PROMPT,
        configurations: nextConfigurations,
      },
    });
  }

  toPublicConfig(config: Config) {
    return {
      id: config.id,
      promptBase: config.promptBase,
      configurations: (config.configurations as Record<string, unknown> | null) ?? {},
      openaiConfigured: Boolean(config.openaiKey.trim()),
      elevenlabsConfigured: Boolean(config.elevenlabsKey?.trim()),
    };
  }
}
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Config, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveConfigDto } from './dto/create-client.dto';

@Injectable()
export class ClientConfigService {
  private static readonly CONFIG_ID = 1;

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<Config> {
    const config = await this.prisma.config.findUnique({
      where: { id: ClientConfigService.CONFIG_ID },
    });

    if (!config) {
      throw new InternalServerErrorException('Config record not found');
    }

    return config;
  }

  async saveConfig(data: SaveConfigDto): Promise<Config> {
    return this.prisma.config.upsert({
      where: { id: ClientConfigService.CONFIG_ID },
      create: {
        id: ClientConfigService.CONFIG_ID,
        openaiKey: data.openaiKey,
        elevenlabsKey: data.elevenlabsKey,
        promptBase: data.promptBase,
        configurations: data.configurations as Prisma.InputJsonValue | undefined,
      },
      update: {
        openaiKey: data.openaiKey,
        elevenlabsKey: data.elevenlabsKey,
        promptBase: data.promptBase,
        configurations: data.configurations as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  @Get('health')
  @Public()
  async getHealth() {
    const [database, redis] = await Promise.all([
      this.prisma.checkHealth(),
      this.redisService.ping(),
    ]);

    return {
      status: database && redis ? 'ok' : 'degraded',
      checks: {
        database,
        redis,
      },
      integrations: {
        openai: Boolean(this.configService.get<string>('OPENAI_API_KEY')?.trim()),
        evolution: Boolean(this.configService.get<string>('EVOLUTION_URL')?.trim()),
        webhook: Boolean(this.configService.get<string>('WEBHOOK_URL')?.trim()),
        storage: Boolean(this.configService.get<string>('STORAGE_PUBLIC_URL')?.trim()),
      },
    };
  }
}
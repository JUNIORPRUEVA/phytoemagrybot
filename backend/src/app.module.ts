import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { BotModule } from './bot/bot.module';
import { BotConfigModule } from './bot-config/bot-config.module';
import { ClientConfigModule } from './config/config.module';
import { HealthController } from './health.controller';
import { MediaModule } from './media/media.module';
import { MemoryModule } from './memory/memory.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    NestConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    ClientConfigModule,
    BotConfigModule,
    MemoryModule,
    MediaModule,
    AiModule,
    BotModule,
    WhatsAppModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
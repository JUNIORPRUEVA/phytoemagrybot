import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { BotModule } from './bot/bot.module';
import { ClientConfigModule } from './config/config.module';
import { HealthController } from './health.controller';
import { MemoryModule } from './memory/memory.module';
import { PrismaModule } from './prisma/prisma.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    NestConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ClientConfigModule,
    MemoryModule,
    AiModule,
    BotModule,
    WhatsAppModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
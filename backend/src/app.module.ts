import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { BotModule } from './bot/bot.module';
import { BotConfigModule } from './bot-config/bot-config.module';
import { CompanyContextModule } from './company-context/company-context.module';
import { ClientConfigModule } from './config/config.module';
import { ConversationsModule } from './conversations/conversations.module';
import { FollowupModule } from './followup/followup.module';
import { HealthController } from './health.controller';
import { MediaModule } from './media/media.module';
import { MemoryModule } from './memory/memory.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'production',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    ClientConfigModule,
    BotConfigModule,
    CompanyContextModule,
    ConversationsModule,
    MemoryModule,
    FollowupModule,
    MediaModule,
    AiModule,
    BotModule,
    WhatsAppModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
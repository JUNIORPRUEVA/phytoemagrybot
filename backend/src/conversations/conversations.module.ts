import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { FollowupModule } from '../followup/followup.module';
import { MemoryModule } from '../memory/memory.module';
import { ConversationsController } from './conversations.controller';

@Module({
  imports: [MemoryModule, BotModule, FollowupModule],
  controllers: [ConversationsController],
})
export class ConversationsModule {}
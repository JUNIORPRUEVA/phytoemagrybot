import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { ClientConfigModule } from '../config/config.module';
import { WhatsAppChannelController } from './channel.controller';
import { VoiceService } from './voice.service';
import { WebhookController } from './webhook.controller';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [BotModule, ClientConfigModule],
  controllers: [WebhookController, WhatsAppChannelController],
  providers: [WhatsAppService, VoiceService],
  exports: [WhatsAppService, VoiceService],
})
export class WhatsAppModule {}
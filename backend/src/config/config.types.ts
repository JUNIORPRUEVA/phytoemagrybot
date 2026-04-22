import { AiSettings, BotSettings, Config, WhatsAppSettings } from '@prisma/client';

export type AppConfigRecord = Config & {
  aiSettings: AiSettings | null;
  botSettings: BotSettings | null;
  whatsappSettings: WhatsAppSettings | null;
};

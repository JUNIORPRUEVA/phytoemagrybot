import { Config } from '@prisma/client';

export type IncomingWhatsAppMessageType = 'text' | 'image' | 'audio';

export interface WhatsAppClientConfiguration {
  webhookSecret: string;
  apiBaseUrl: string;
  apiKey: string;
  instanceName: string;
  fallbackMessage?: string;
  audioVoiceId?: string;
}

export interface ResolvedWhatsAppClient {
  config: Config;
  whatsapp: WhatsAppClientConfiguration;
}

export interface NormalizedIncomingWhatsAppMessage {
  number: string;
  message: string;
  type: IncomingWhatsAppMessageType;
  messageId: string | null;
  rawPayload: Record<string, unknown>;
}
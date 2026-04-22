import { AppConfigRecord } from '../config/config.types';

export type IncomingWhatsAppMessageType = 'text' | 'image' | 'audio';

export interface WhatsAppClientConfiguration {
  webhookSecret: string;
  apiBaseUrl: string;
  apiKey: string;
  instanceName: string;
  fallbackMessage?: string;
  audioVoiceId?: string;
  elevenLabsBaseUrl?: string;
}

export interface ResolvedWhatsAppClient {
  config: AppConfigRecord;
  whatsapp: WhatsAppClientConfiguration;
}

export interface WhatsAppChannelStatus {
  provider: 'evolution';
  instanceName: string;
  status: string;
  connected: boolean;
  qrCode: string | null;
  qrCodeBase64: string | null;
  details: Record<string, unknown>;
}

export interface WhatsAppQrResponse {
  instanceName: string;
  qrCodeBase64: string | null;
  status: 'connected' | 'disconnected';
  message: string;
}

export interface WhatsAppWebhookConfigResponse {
  instanceName: string;
  webhook: string;
  events: string[];
  message: string;
}

export interface NormalizedIncomingWhatsAppMessage {
  number: string;
  message: string;
  type: IncomingWhatsAppMessageType;
  messageId: string | null;
  rawPayload: Record<string, unknown>;
}

export interface BufferedWhatsAppMessage {
  message: string;
  type: IncomingWhatsAppMessageType;
  messageId: string | null;
  receivedAt: number;
}

export interface WebhookProcessingResult {
  ok: true;
  accepted?: true;
  ignored?: true;
  buffered?: true;
  fallback?: true;
  deliveredAs?: 'text' | 'audio';
  contactId?: string;
  messageType?: IncomingWhatsAppMessageType;
}

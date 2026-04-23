import { AppConfigRecord } from '../config/config.types';

export type IncomingWhatsAppMessageType = 'text' | 'image' | 'audio';

export interface IncomingAudioMetadata {
  base64?: string;
  mediaUrl?: string;
  mediaKey?: string;
  directPath?: string;
  mimetype?: string;
  seconds?: number;
  ptt: boolean;
}

export interface WhatsAppClientConfiguration {
  webhookSecret: string;
  webhookUrl?: string;
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

export interface WhatsAppInstanceRecord {
  id: number;
  name: string;
  displayName: string | null;
  status: string;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ManagedWhatsAppInstance {
  id: number;
  name: string;
  displayName: string | null;
  status: 'connected' | 'disconnected' | 'connecting';
  phone: string | null;
  connected: boolean;
  webhookReady: boolean;
  webhookTarget: string | null;
  createdAt: string;
  updatedAt: string;
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
  outboundAddress?: string;
  pushName?: string;
  message: string;
  type: IncomingWhatsAppMessageType;
  messageId: string | null;
  audio?: IncomingAudioMetadata;
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
  deliveredAs?: 'text' | 'audio' | 'image' | 'video';
  contactId?: string;
  messageType?: IncomingWhatsAppMessageType;
  traceId?: string;
}

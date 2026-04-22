import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { BotService } from '../bot/bot.service';
import { ClientConfigService } from '../config/config.service';
import { RedisService } from '../redis/redis.service';
import { VoiceService } from './voice.service';
import {
  NormalizedIncomingWhatsAppMessage,
  ResolvedWhatsAppClient,
  WebhookProcessingResult,
  WhatsAppClientConfiguration,
} from './whatsapp.types';

type HeaderMap = Record<string, string | string[] | undefined>;
type JsonRecord = Record<string, unknown>;

const SPAM_GROUP_WINDOW_MS = 2000;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly botService: BotService,
    private readonly clientConfigService: ClientConfigService,
    private readonly redisService: RedisService,
    private readonly voiceService: VoiceService,
  ) {}

  acceptWebhook(
    payload: JsonRecord,
    headers: HeaderMap,
  ): WebhookProcessingResult {
    this.validatePayloadShape(payload);

    void this.processWebhook(payload, headers).catch((error: unknown) => {
      this.logger.error(
        JSON.stringify({
          event: 'whatsapp_async_processing_failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
        error instanceof Error ? error.stack : undefined,
      );
    });

    return { ok: true, accepted: true };
  }

  async sendText(
    resolved: ResolvedWhatsAppClient,
    to: string,
    text: string,
  ): Promise<void> {
    await this.executeEvolutionRequest(
      resolved,
      'sendText',
      `/message/sendText/${resolved.whatsapp.instanceName}`,
      {
        number: this.normalizeNumber(to),
        text,
        options: {
          delay: 0,
          presence: 'composing',
        },
      },
    );
  }

  async sendImage(
    resolved: ResolvedWhatsAppClient,
    to: string,
    imageUrl: string,
    caption = '',
  ): Promise<void> {
    await this.executeEvolutionRequest(
      resolved,
      'sendImage',
      `/message/sendMedia/${resolved.whatsapp.instanceName}`,
      {
        number: this.normalizeNumber(to),
        mediatype: 'image',
        mimetype: 'image/jpeg',
        media: imageUrl,
        caption,
        fileName: 'image.jpg',
      },
    );
  }

  async sendAudio(
    resolved: ResolvedWhatsAppClient,
    to: string,
    audio: Buffer | string,
  ): Promise<void> {
    await this.executeEvolutionRequest(
      resolved,
      'sendAudio',
      `/message/sendWhatsAppAudio/${resolved.whatsapp.instanceName}`,
      {
        number: this.normalizeNumber(to),
        audio: Buffer.isBuffer(audio) ? audio.toString('base64') : audio,
        fileName: 'reply.mp3',
        mimetype: 'audio/mpeg',
      },
    );
  }

  private async processWebhook(payload: JsonRecord, headers: HeaderMap): Promise<void> {
    const resolved = await this.resolveConfig();
    this.validateWebhook(headers, resolved.whatsapp);

    const incoming = this.normalizeWebhookPayload(payload);
    if (!incoming) {
      this.logger.log(
        JSON.stringify({
          event: 'whatsapp_webhook_ignored',
          reason: 'unsupported_or_outbound_payload',
        }),
      );
      return;
    }

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_webhook_received',
        contactId: incoming.number,
        messageType: incoming.type,
        messageId: incoming.messageId,
      }),
    );

    if (incoming.type === 'text') {
      const shouldScheduleFlush = await this.redisService.appendGroupedMessage(
        incoming.number,
        incoming.message,
        SPAM_GROUP_WINDOW_MS,
      );

      if (shouldScheduleFlush) {
        setTimeout(() => {
          void this.flushGroupedTextMessage(incoming.number).catch((error: unknown) => {
            this.logger.error(
              JSON.stringify({
                event: 'grouped_message_flush_failed',
                contactId: incoming.number,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
              error instanceof Error ? error.stack : undefined,
            );
          });
        }, SPAM_GROUP_WINDOW_MS);
      }

      return;
    }

    await this.processAndDeliverMessage(resolved, incoming.number, incoming.message, incoming.type);
  }

  private async flushGroupedTextMessage(contactId: string): Promise<void> {
    const resolved = await this.resolveConfig();
    const groupedMessage = await this.redisService.consumeGroupedMessage(contactId);

    if (!groupedMessage?.trim()) {
      return;
    }

    await this.processAndDeliverMessage(resolved, contactId, groupedMessage, 'text');
  }

  private async processAndDeliverMessage(
    resolved: ResolvedWhatsAppClient,
    contactId: string,
    message: string,
    messageType: 'text' | 'image' | 'audio',
  ): Promise<void> {
    const fallbackMessage =
      resolved.whatsapp.fallbackMessage ??
      'En este momento no pude procesar tu mensaje. Intenta nuevamente en unos minutos.';

    let botReply: { reply: string; replyType: 'text' | 'audio' };
    try {
      botReply = await this.botService.processIncomingMessage(contactId, message);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'ai_processing_failed',
          contactId,
          messageType,
        }),
        error instanceof Error ? error.stack : undefined,
      );

      await this.sendText(resolved, contactId, fallbackMessage);
      return;
    }

    if (botReply.replyType === 'audio') {
      setImmediate(() => {
        void this.processAudioReply(resolved, contactId, botReply.reply).catch((error: unknown) => {
          this.logger.error(
            JSON.stringify({
              event: 'audio_delivery_failed',
              contactId,
              error: error instanceof Error ? error.message : 'Unknown error',
            }),
            error instanceof Error ? error.stack : undefined,
          );
        });
      });

      return;
    }

    await this.sendText(resolved, contactId, botReply.reply);
  }

  private async processAudioReply(
    resolved: ResolvedWhatsAppClient,
    contactId: string,
    text: string,
  ): Promise<void> {
    try {
      const audio = await this.voiceService.generateVoice(
        text,
        resolved.config.elevenlabsKey ?? '',
        resolved.whatsapp.audioVoiceId,
        resolved.whatsapp.elevenLabsBaseUrl,
      );

      await this.sendAudio(resolved, contactId, audio);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'voice_generation_failed',
          contactId,
        }),
        error instanceof Error ? error.stack : undefined,
      );

      await this.sendText(resolved, contactId, text);
    }
  }

  private async resolveConfig(): Promise<ResolvedWhatsAppClient> {
    const config = await this.clientConfigService.getConfig();

    return {
      config,
      whatsapp: this.extractWhatsAppConfiguration(config),
    };
  }

  private extractWhatsAppConfiguration(config: {
    configurations: unknown;
    id: number;
  }): WhatsAppClientConfiguration {
    const configurations = this.asRecord(config.configurations);
    const whatsapp = this.asRecord(configurations.whatsapp);
    const elevenLabs = this.asRecord(configurations.elevenlabs);

    const webhookSecret = this.asString(whatsapp.webhookSecret);
    const apiBaseUrl = this.asString(whatsapp.apiBaseUrl);
    const apiKey = this.asString(whatsapp.apiKey);
    const instanceName = this.asString(whatsapp.instanceName);

    if (!webhookSecret || !apiBaseUrl || !apiKey || !instanceName) {
      throw new HttpException(
        `Config ${config.id} is missing WhatsApp configuration`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      webhookSecret,
      apiBaseUrl,
      apiKey,
      instanceName,
      fallbackMessage: this.asString(whatsapp.fallbackMessage),
      audioVoiceId: this.asString(whatsapp.audioVoiceId),
      elevenLabsBaseUrl: this.asString(elevenLabs.baseUrl),
    };
  }

  private validateWebhook(headers: HeaderMap, whatsapp: WhatsAppClientConfiguration): void {
    const providedSecret = this.readHeader(headers, 'x-webhook-secret');

    if (!providedSecret || providedSecret !== whatsapp.webhookSecret) {
      throw new HttpException('Invalid webhook secret', HttpStatus.UNAUTHORIZED);
    }
  }

  private validatePayloadShape(payload: JsonRecord): void {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Webhook payload must be an object');
    }

    const data = this.asRecord(payload.data);
    const key = this.asRecord(data.key);
    const hasData = Object.keys(data).length > 0;
    const hasMessageEnvelope =
      Object.keys(key).length > 0 || Object.keys(this.asRecord(data.message)).length > 0;
    const hasSender = Boolean(this.asString(payload.sender) || this.asString(payload.from));

    if (!hasData && !hasSender) {
      throw new BadRequestException('Webhook payload is missing data section');
    }

    if (hasData && !hasMessageEnvelope && !hasSender) {
      throw new BadRequestException('Webhook payload is missing sender metadata');
    }
  }

  private normalizeWebhookPayload(
    payload: JsonRecord,
  ): NormalizedIncomingWhatsAppMessage | null {
    const event = typeof payload.event === 'string' ? payload.event : undefined;
    if (event && !event.includes('message')) {
      return null;
    }

    const data = this.asRecord(payload.data);
    const key = this.asRecord(data.key);
    const message = this.asRecord(data.message);
    const fromMe = Boolean(key.fromMe ?? data.fromMe);

    if (!Object.keys(message).length || fromMe) {
      return null;
    }

    const number = this.normalizeNumber(
      this.asString(key.remoteJid) ||
        this.asString(data.remoteJid) ||
        this.asString(payload.sender) ||
        this.asString(payload.from) ||
        '',
    );

    if (!number) {
      throw new BadRequestException('Incoming payload does not contain a valid phone number');
    }

    const type = this.detectMessageType(message, this.asString(data.messageType));
    const text = this.extractMessageText(message);

    if (type === 'text' && !text.trim()) {
      throw new BadRequestException('Incoming text message content is empty');
    }

    return {
      number,
      message: type === 'text' ? text : text || `[${type}]`,
      type,
      messageId: this.asString(key.id) ?? this.asString(data.messageId) ?? null,
      rawPayload: payload,
    };
  }

  private detectMessageType(
    message: JsonRecord,
    messageType?: string,
  ): 'text' | 'image' | 'audio' {
    if (messageType === 'audioMessage' || this.hasNestedObject(message, 'audioMessage')) {
      return 'audio';
    }

    if (messageType === 'imageMessage' || this.hasNestedObject(message, 'imageMessage')) {
      return 'image';
    }

    return 'text';
  }

  private extractMessageText(message: JsonRecord): string {
    const extendedTextMessage = this.asRecord(message.extendedTextMessage);
    const imageMessage = this.asRecord(message.imageMessage);
    const videoMessage = this.asRecord(message.videoMessage);
    const documentWithCaptionMessage = this.asRecord(message.documentWithCaptionMessage);
    const documentMessage = this.asRecord(documentWithCaptionMessage.message);
    const nestedDocument = this.asRecord(documentMessage.documentMessage);

    return (
      this.asString(message.conversation) ||
      this.asString(extendedTextMessage.text) ||
      this.asString(imageMessage.caption) ||
      this.asString(videoMessage.caption) ||
      this.asString(nestedDocument.caption) ||
      ''
    );
  }

  private createEvolutionClient(whatsapp: WhatsAppClientConfiguration): AxiosInstance {
    return axios.create({
      baseURL: whatsapp.apiBaseUrl.replace(/\/$/, ''),
      timeout: 20000,
      headers: {
        apikey: whatsapp.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  private async executeEvolutionRequest(
    resolved: ResolvedWhatsAppClient,
    action: 'sendText' | 'sendImage' | 'sendAudio',
    path: string,
    body: JsonRecord,
  ): Promise<void> {
    try {
      await this.createEvolutionClient(resolved.whatsapp).post(path, body);
      this.logger.log(
        JSON.stringify({
          event: 'whatsapp_delivery_success',
          action,
          configId: resolved.config.id,
          instanceName: resolved.whatsapp.instanceName,
        }),
      );
    } catch (error) {
      const axiosError = error as AxiosError<unknown>;
      this.logger.error(
        JSON.stringify({
          event: 'whatsapp_delivery_failure',
          action,
          configId: resolved.config.id,
          instanceName: resolved.whatsapp.instanceName,
          status: axiosError.response?.status,
          response: axiosError.response?.data,
        }),
        error instanceof Error ? error.stack : undefined,
      );

      throw new HttpException(`Evolution API ${action} failed`, HttpStatus.BAD_GATEWAY);
    }
  }

  private normalizeNumber(raw: string): string {
    return raw.replace(/@.*/, '').replace(/\D/g, '');
  }

  private readHeader(headers: HeaderMap, headerName: string): string | undefined {
    const value = headers[headerName] ?? headers[headerName.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  private hasNestedObject(record: JsonRecord, key: string): boolean {
    return typeof record[key] === 'object' && record[key] !== null;
  }

  private asRecord(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null ? (value as JsonRecord) : {};
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}

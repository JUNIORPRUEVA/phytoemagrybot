import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Client } from '@prisma/client';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { BotService } from '../bot/bot.service';
import { ClientConfigService } from '../config/config.service';
import { VoiceService } from './voice.service';
import {
  NormalizedIncomingWhatsAppMessage,
  ResolvedWhatsAppClient,
  WebhookProcessingResult,
  WhatsAppClientConfiguration,
} from './whatsapp.types';

type HeaderMap = Record<string, string | string[] | undefined>;
type JsonRecord = Record<string, unknown>;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly botService: BotService,
    private readonly clientConfigService: ClientConfigService,
    private readonly voiceService: VoiceService,
  ) {}

  async handleWebhook(
    payload: JsonRecord,
    headers: HeaderMap,
  ): Promise<WebhookProcessingResult> {
    this.validatePayloadShape(payload);

    const resolved = await this.resolveClient(payload, headers);
    this.validateWebhook(headers, resolved.whatsapp);

    const incoming = this.normalizeWebhookPayload(payload);
    if (!incoming) {
      this.logger.log(
        JSON.stringify({
          event: 'whatsapp_webhook_ignored',
          clientId: resolved.client.id,
          reason: 'unsupported_or_outbound_payload',
        }),
      );

      return { ok: true, ignored: true };
    }

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_webhook_received',
        clientId: resolved.client.id,
        contactId: incoming.number,
        messageType: incoming.type,
        messageId: incoming.messageId,
      }),
    );

    let botReply: { reply: string; replyType: 'text' | 'audio' };
    try {
      botReply = await this.botService.processIncomingMessage(
        resolved.client.id,
        incoming.number,
        incoming.message,
      );
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'ai_processing_failed',
          clientId: resolved.client.id,
          contactId: incoming.number,
          messageType: incoming.type,
        }),
        error instanceof Error ? error.stack : undefined,
      );

      await this.sendText(
        resolved,
        incoming.number,
        resolved.whatsapp.fallbackMessage ??
          'En este momento no pude procesar tu mensaje. Intenta nuevamente en unos minutos.',
      );

      return {
        ok: true,
        fallback: true,
        deliveredAs: 'text',
        contactId: incoming.number,
        messageType: incoming.type,
      };
    }

    if (botReply.replyType === 'audio') {
      try {
        const audio = await this.voiceService.generateVoice(
          botReply.reply,
          resolved.client.elevenlabsKey ?? '',
          resolved.whatsapp.audioVoiceId,
          resolved.whatsapp.elevenLabsBaseUrl,
        );

        await this.sendAudio(resolved, incoming.number, audio);

        return {
          ok: true,
          deliveredAs: 'audio',
          contactId: incoming.number,
          messageType: incoming.type,
        };
      } catch (error) {
        this.logger.error(
          JSON.stringify({
            event: 'voice_generation_failed',
            clientId: resolved.client.id,
            contactId: incoming.number,
          }),
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    await this.sendText(resolved, incoming.number, botReply.reply);

    return {
      ok: true,
      deliveredAs: 'text',
      contactId: incoming.number,
      messageType: incoming.type,
    };
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

  private async resolveClient(
    payload: JsonRecord,
    headers: HeaderMap,
  ): Promise<ResolvedWhatsAppClient> {
    const clients = await this.clientConfigService.findAll();
    const headerClientId = this.readHeader(headers, 'x-client-id');
    const payloadInstance = this.readPayloadValue(payload, [
      'instance',
      'instanceName',
      'sender',
    ]);

    const configuredClients = clients
      .map((client) => ({
        client,
        whatsapp: this.tryExtractWhatsAppConfiguration(client),
      }))
      .filter(
        (
          candidate,
        ): candidate is { client: Client; whatsapp: WhatsAppClientConfiguration } =>
          candidate.whatsapp !== null,
      );

    const resolved = configuredClients.find(({ client, whatsapp }) =>
      [headerClientId, payloadInstance].some(
        (candidate) =>
          candidate !== undefined &&
          candidate !== null &&
          candidate !== '' &&
          [client.id, whatsapp.instanceName].includes(String(candidate)),
      ),
    );

    if (resolved) {
      return resolved;
    }

    if (configuredClients.length === 1) {
      return configuredClients[0];
    }

    throw new HttpException(
      'Unable to resolve tenant for WhatsApp webhook',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private tryExtractWhatsAppConfiguration(
    client: Client,
  ): WhatsAppClientConfiguration | null {
    const configurations = this.asRecord(client.configurations);
    const whatsapp = this.asRecord(configurations.whatsapp);
    const elevenLabs = this.asRecord(configurations.elevenlabs);

    const webhookSecret = this.asString(whatsapp.webhookSecret);
    const apiBaseUrl = this.asString(whatsapp.apiBaseUrl);
    const apiKey = this.asString(whatsapp.apiKey);
    const instanceName = this.asString(whatsapp.instanceName);

    if (!webhookSecret || !apiBaseUrl || !apiKey || !instanceName) {
      return null;
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
    const hasMessageEnvelope = Object.keys(key).length > 0 || Boolean(this.asRecord(data.message));
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
      messageId: this.asString(key.id) || this.asString(data.messageId) || null,
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
          clientId: resolved.client.id,
          instanceName: resolved.whatsapp.instanceName,
        }),
      );
    } catch (error) {
      const axiosError = error as AxiosError<unknown>;
      this.logger.error(
        JSON.stringify({
          event: 'whatsapp_delivery_failure',
          action,
          clientId: resolved.client.id,
          instanceName: resolved.whatsapp.instanceName,
          status: axiosError.response?.status,
          response: axiosError.response?.data,
        }),
        error instanceof Error ? error.stack : undefined,
      );

      throw new HttpException(
        `Evolution API ${action} failed`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private normalizeNumber(raw: string): string {
    return raw.replace(/@.*/, '').replace(/\D/g, '');
  }

  private readPayloadValue(payload: JsonRecord, keys: string[]): string | undefined {
    for (const key of keys) {
      const topLevel = this.asString(payload[key]);
      if (topLevel) {
        return topLevel;
      }

      const nested = this.asString(this.asRecord(payload.data)[key]);
      if (nested) {
        return nested;
      }
    }

    return undefined;
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
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { BotService } from '../bot/bot.service';
import { ClientConfigService } from '../config/config.service';
import { VoiceService } from './voice.service';
import {
  NormalizedIncomingWhatsAppMessage,
  ResolvedWhatsAppClient,
  WhatsAppClientConfiguration,
} from './whatsapp.types';

type HeaderMap = Record<string, string | string[] | undefined>;
type JsonRecord = Record<string, unknown>;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly botService: BotService,
    private readonly clientConfigService: ClientConfigService,
    private readonly voiceService: VoiceService,
  ) {}

  async handleWebhook(payload: JsonRecord, headers: HeaderMap) {
    const resolved = await this.resolveClient(payload, headers);
    this.validateWebhook(headers, resolved.whatsapp);

    const incoming = this.normalizeWebhookPayload(payload);
    if (!incoming) {
      this.logger.log('Ignoring unsupported WhatsApp webhook payload');
      return { ok: true, ignored: true };
    }

    this.logger.log(
      JSON.stringify({
        configId: resolved.config.id,
        number: incoming.number,
        type: incoming.type,
        messageId: incoming.messageId,
      }),
    );

    let botReply: { reply: string; replyType: 'text' | 'audio' };
    try {
      botReply = await this.botService.processIncomingMessage(incoming.number, incoming.message);
    } catch (error) {
      this.logger.error(
        `AI processing failed for config ${resolved.config.id} and contact ${incoming.number}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.sendText(
        resolved,
        incoming.number,
        resolved.whatsapp.fallbackMessage ??
          'En este momento no pude procesar tu mensaje. Intenta nuevamente en unos minutos.',
      );

      return { ok: true, fallback: true };
    }

    if (botReply.replyType === 'audio') {
      try {
        const audio = await this.voiceService.generateVoice(
          botReply.reply,
          resolved.config.elevenlabsKey ?? '',
          resolved.whatsapp.audioVoiceId,
        );

        await this.sendAudio(resolved, incoming.number, audio);
        return { ok: true, deliveredAs: 'audio' };
      } catch (error) {
        this.logger.error(
          `Voice generation failed for config ${resolved.config.id}; falling back to text`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    await this.sendText(resolved, incoming.number, botReply.reply);
    return { ok: true, deliveredAs: 'text' };
  }

  async sendText(
    resolved: ResolvedWhatsAppClient,
    to: string,
    text: string,
  ): Promise<void> {
    await this.createEvolutionClient(resolved.whatsapp).post(
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
    await this.createEvolutionClient(resolved.whatsapp).post(
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
    await this.createEvolutionClient(resolved.whatsapp).post(
      `/message/sendWhatsAppAudio/${resolved.whatsapp.instanceName}`,
      {
        number: this.normalizeNumber(to),
        audio: Buffer.isBuffer(audio) ? audio.toString('base64') : audio,
        fileName: 'reply.mp3',
        mimetype: 'audio/mpeg',
      },
    );
  }

  private async resolveClient(
    payload: JsonRecord,
    headers: HeaderMap,
  ): Promise<ResolvedWhatsAppClient> {
    void payload;
    void headers;

    const config = await this.clientConfigService.getConfig();

    return {
      config,
      whatsapp: this.extractWhatsAppConfiguration(config),
    };
  }

  private extractWhatsAppConfiguration(config: { configurations: unknown; id: number }): WhatsAppClientConfiguration {
    const configurations = this.asRecord(config.configurations);
    const whatsapp = this.asRecord(configurations.whatsapp);

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
    };
  }

  private validateWebhook(headers: HeaderMap, whatsapp: WhatsAppClientConfiguration): void {
    const providedSecret = this.readHeader(headers, 'x-webhook-secret');

    if (!providedSecret || providedSecret !== whatsapp.webhookSecret) {
      throw new HttpException('Invalid webhook secret', HttpStatus.UNAUTHORIZED);
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
      return null;
    }

    const type = this.detectMessageType(message, this.asString(data.messageType));
    const text = this.extractMessageText(message);

    return {
      number,
      message: type === 'text' ? text : text || `[${type}]`,
      type,
      messageId: this.asString(key.id) || this.asString(data.messageId) || null,
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

  private normalizeNumber(raw: string): string {
    return raw.replace(/@.*/, '').replace(/\D/g, '');
  }

  private readPayloadValue(payload: JsonRecord, keys: string[]): string | undefined {
    for (const key of keys) {
      const topLevel = this.asString(payload[key]);
      if (topLevel) {
        return topLevel;
      }

      const nested = this.asString(this.asRecord(payload.data)[key]);
      if (nested) {
        return nested;
      }
    }

    return undefined;
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
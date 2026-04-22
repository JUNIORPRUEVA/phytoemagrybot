import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { BotService } from '../bot/bot.service';
import { ClientConfigService } from '../config/config.service';
import { RedisService } from '../redis/redis.service';
import { VoiceService } from './voice.service';
import {
  NormalizedIncomingWhatsAppMessage,
  ResolvedWhatsAppClient,
  WebhookProcessingResult,
  WhatsAppChannelStatus,
  WhatsAppClientConfiguration,
  WhatsAppQrResponse,
  WhatsAppWebhookConfigResponse,
} from './whatsapp.types';

type HeaderMap = Record<string, string | string[] | undefined>;
type JsonRecord = Record<string, unknown>;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly botService: BotService,
    private readonly clientConfigService: ClientConfigService,
    private readonly configService: ConfigService,
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

  async createInstance(instanceName: string): Promise<WhatsAppChannelStatus> {
    const normalizedInstanceName = this.normalizeInstanceName(instanceName);
    const client = this.getEvolutionClient();

    try {
      await client.post('/instance/create', {
        instanceName: normalizedInstanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
      });

      return await this.getStatus(normalizedInstanceName);
    } catch (error) {
      this.handleEvolutionError(error, 'No fue posible crear la instancia de WhatsApp.');
    }
  }

  async getQr(instanceName: string): Promise<WhatsAppQrResponse> {
    const normalizedInstanceName = this.normalizeInstanceName(instanceName);
    const client = this.getEvolutionClient();

    try {
      const response = await client.get(`/instance/connect/${normalizedInstanceName}`);
      const payload = this.asRecord(response.data);
      const base64 = this.extractQrCodeBase64(payload);
      const connected = this.readConnectedFlag(payload) || !base64;

      return {
        instanceName: normalizedInstanceName,
        qrCodeBase64: base64,
        status: connected ? 'connected' : 'disconnected',
        message: connected
          ? 'La instancia ya se encuentra conectada.'
          : base64
            ? 'QR obtenido correctamente.'
            : 'No hay QR disponible para esta instancia.',
      };
    } catch (error) {
      this.handleEvolutionError(error, 'No fue posible obtener el QR de WhatsApp.');
    }
  }

  async setWebhook(
    instanceName: string,
    webhook?: string,
    events?: string[],
  ): Promise<WhatsAppWebhookConfigResponse> {
    const normalizedInstanceName = this.normalizeInstanceName(instanceName);
    const client = this.getEvolutionClient();
    const resolvedWebhook = webhook?.trim() || this.getRequiredEnv('WEBHOOK_URL');
    const resolvedEvents = events?.length ? events : ['messages.upsert'];

    try {
      await client.post(`/webhook/set/${normalizedInstanceName}`, {
        webhook: resolvedWebhook,
        events: resolvedEvents,
      });

      return {
        instanceName: normalizedInstanceName,
        webhook: resolvedWebhook,
        events: resolvedEvents,
        message: 'Webhook configurado correctamente.',
      };
    } catch (error) {
      this.handleEvolutionError(error, 'No fue posible configurar el webhook de WhatsApp.');
    }
  }

  async getStatus(instanceName: string): Promise<WhatsAppChannelStatus> {
    const normalizedInstanceName = this.normalizeInstanceName(instanceName);
    const client = this.getEvolutionClient();

    try {
      const response = await client.get('/instance/fetchInstances');
      const payload = response.data;
      const instances = this.extractInstances(payload);
      const instance = instances.find((item) => {
        const data = this.asRecord(item);
        return this.readInstanceName(data) === normalizedInstanceName;
      });

      if (!instance) {
        throw new HttpException(
          `La instancia ${normalizedInstanceName} no existe en Evolution.`,
          HttpStatus.NOT_FOUND,
        );
      }

      const details = this.asRecord(instance);
      const status = this.readInstanceStatus(details);
      const qrCodeBase64 = this.extractQrCodeBase64(details);
      const connected = status === 'connected';

      return {
        provider: 'evolution',
        instanceName: normalizedInstanceName,
        status,
        connected,
        qrCode: qrCodeBase64,
        qrCodeBase64,
        details,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.handleEvolutionError(error, 'No fue posible consultar el estado de WhatsApp.');
    }
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

    const spamGroupWindowMs = resolved.config.botSettings?.spamGroupWindowMs ?? 2000;

    if (incoming.type === 'text') {
      const shouldScheduleFlush = await this.redisService.appendGroupedMessage(
        incoming.number,
        incoming.message,
        spamGroupWindowMs,
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
        }, spamGroupWindowMs);
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

    if (
      botReply.replyType === 'audio' &&
      (resolved.config.botSettings?.allowAudioReplies ?? true)
    ) {
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

  private getEvolutionClient(): AxiosInstance {
    const baseURL = this.getRequiredEnv('EVOLUTION_URL');
    const apiKey = this.getRequiredEnv('AUTHENTICATION_API_KEY');

    return axios.create({
      baseURL: baseURL.replace(/\/+$/, ''),
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  private getRequiredEnv(name: 'EVOLUTION_URL' | 'AUTHENTICATION_API_KEY' | 'WEBHOOK_URL'): string {
    const value = this.configService.get<string>(name)?.trim();

    if (!value) {
      throw new HttpException(
        `La variable de entorno ${name} es obligatoria.`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return value;
  }

  private normalizeInstanceName(instanceName: string): string {
    const normalizedInstanceName = instanceName.trim();

    if (!normalizedInstanceName) {
      throw new BadRequestException('instanceName es obligatorio.');
    }

    return normalizedInstanceName;
  }

  private extractInstances(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
      return payload;
    }

    const data = this.asRecord(payload);
    const records = data.instances ?? data.data ?? data.response;

    return Array.isArray(records) ? records : [];
  }

  private readInstanceName(data: JsonRecord): string {
    const instance = this.asRecord(data.instance);
    const instanceData = this.asRecord(data.instanceData);

    return (
      this.asString(data.instanceName) ||
      this.asString(instance.instanceName) ||
      this.asString(instance.name) ||
      this.asString(instanceData.instanceName) ||
      this.asString(instanceData.name) ||
      ''
    );
  }

  private readInstanceStatus(data: JsonRecord): string {
    const instance = this.asRecord(data.instance);
    const instanceData = this.asRecord(data.instanceData);
    const rawStatus = (
      this.asString(data.status) ||
      this.asString(data.connectionStatus) ||
      this.asString(instance.status) ||
      this.asString(instance.connectionStatus) ||
      this.asString(instanceData.status) ||
      this.asString(instanceData.connectionStatus) ||
      'disconnected'
    ).toLowerCase();

    return rawStatus.includes('open') || rawStatus.includes('connect')
      ? 'connected'
      : 'disconnected';
  }

  private readConnectedFlag(data: JsonRecord): boolean {
    const instance = this.asRecord(data.instance);
    const base = [
      data.connected,
      data.isConnected,
      data.qrcode === null,
      instance.connected,
      instance.isConnected,
    ];

    return base.some((value) => value === true);
  }

  private extractQrCodeBase64(payload: JsonRecord): string | null {
    const qrcode = this.asRecord(payload.qrcode);
    const base64 =
      this.asString(payload.base64) ||
      this.asString(payload.qrCodeBase64) ||
      this.asString(payload.qrcode) ||
      this.asString(qrcode.base64) ||
      this.asString(qrcode.code) ||
      this.asString(this.asRecord(payload.instance).qrcode) ||
      this.asString(this.asRecord(payload.instanceData).qrcode);

    return base64?.trim() ? base64.trim() : null;
  }

  private handleEvolutionError(error: unknown, fallbackMessage: string): never {
    if (error instanceof HttpException) {
      throw error;
    }

    if (axios.isAxiosError(error)) {
      const responseData = this.asRecord(error.response?.data);
      const message =
        this.asString(responseData.message) ||
        this.asString(responseData.error) ||
        error.message ||
        fallbackMessage;

      throw new HttpException(message, error.response?.status ?? HttpStatus.BAD_GATEWAY);
    }

    throw new HttpException(fallbackMessage, HttpStatus.BAD_GATEWAY);
  }

  private extractWhatsAppConfiguration(config: {
    configurations: unknown;
    id: number;
    whatsappSettings?: {
      webhookSecret: string;
      apiBaseUrl: string;
      apiKey: string;
      instanceName: string;
      fallbackMessage: string | null;
      audioVoiceId: string | null;
      elevenLabsBaseUrl: string | null;
    } | null;
  }): WhatsAppClientConfiguration {
    const configurations = this.asRecord(config.configurations);
    const whatsapp = this.asRecord(configurations.whatsapp);
    const elevenLabs = this.asRecord(configurations.elevenlabs);
    const persisted = config.whatsappSettings;

    const webhookSecret = persisted?.webhookSecret?.trim() || this.asString(whatsapp.webhookSecret);
    const apiBaseUrl = persisted?.apiBaseUrl?.trim() || this.asString(whatsapp.apiBaseUrl);
    const apiKey = persisted?.apiKey?.trim() || this.asString(whatsapp.apiKey);
    const instanceName =
      persisted?.instanceName?.trim() || this.asString(whatsapp.instanceName);

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
      fallbackMessage:
        persisted?.fallbackMessage?.trim() || this.asString(whatsapp.fallbackMessage),
      audioVoiceId: persisted?.audioVoiceId?.trim() || this.asString(whatsapp.audioVoiceId),
      elevenLabsBaseUrl:
        persisted?.elevenLabsBaseUrl?.trim() || this.asString(elevenLabs.baseUrl),
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

  private async readChannelStatus(
    resolved: ResolvedWhatsAppClient,
    includeQrCode: boolean,
    preferFreshQr = false,
  ): Promise<WhatsAppChannelStatus> {
    const payload = await this.readEvolutionResource(resolved, [
      { path: `/instance/connectionState/${resolved.whatsapp.instanceName}`, method: 'get' },
      { path: `/instance/status/${resolved.whatsapp.instanceName}`, method: 'get' },
    ]);

    const status = this.extractConnectionStatus(payload);
    const connected = this.extractConnectedFlag(payload, status);
    let qrCode: string | null = null;
    let qrCodeBase64: string | null = null;

    if (includeQrCode && !connected) {
      const qrPayload = await this.readEvolutionResource(
        resolved,
        preferFreshQr
            ? [
                {
                  path: `/instance/connect/${resolved.whatsapp.instanceName}`,
                  method: 'get',
                },
                {
                  path: `/instance/connect/${resolved.whatsapp.instanceName}`,
                  method: 'post',
                },
                {
                  path: `/instance/qrcode/${resolved.whatsapp.instanceName}`,
                  method: 'get',
                },
              ]
            : [
                {
                  path: `/instance/qrcode/${resolved.whatsapp.instanceName}`,
                  method: 'get',
                },
                {
                  path: `/instance/connect/${resolved.whatsapp.instanceName}`,
                  method: 'get',
                },
                {
                  path: `/instance/connect/${resolved.whatsapp.instanceName}`,
                  method: 'post',
                },
              ],
      );

      const qrData = this.extractQrData(qrPayload);
      qrCode = qrData.qrCode;
      qrCodeBase64 = qrData.qrCodeBase64;
    }

    return {
      provider: 'evolution',
      instanceName: resolved.whatsapp.instanceName,
      status,
      connected,
      qrCode,
      qrCodeBase64,
      details: this.asRecord(payload),
    };
  }

  private async createEvolutionInstance(
    resolved: ResolvedWhatsAppClient,
  ): Promise<void> {
    const client = this.createEvolutionClient(resolved.whatsapp);

    try {
      await client.post('/instance/create', {
        instanceName: resolved.whatsapp.instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
      });
    } catch (error) {
      const axiosError = error as AxiosError<unknown>;
      const responseStatus = axiosError.response?.status;
      const responseBody = JSON.stringify(axiosError.response?.data ?? {}).toLowerCase();
      const alreadyExists =
        responseStatus === 400 ||
        responseStatus === 409 ||
        responseBody.includes('already exists') ||
        responseBody.includes('already exist') ||
        responseBody.includes('duplicate') ||
        responseBody.includes('exists');

      if (alreadyExists) {
        return;
      }

      this.logger.error(
        JSON.stringify({
          event: 'whatsapp_instance_create_failed',
          configId: resolved.config.id,
          instanceName: resolved.whatsapp.instanceName,
          status: responseStatus,
          response: axiosError.response?.data,
        }),
        error instanceof Error ? error.stack : undefined,
      );

      throw new HttpException(
        'No se pudo crear la instancia en Evolution API',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private async readEvolutionResource(
    resolved: ResolvedWhatsAppClient,
    attempts: Array<{
      path: string;
      method: 'get' | 'post';
    }>,
  ): Promise<unknown> {
    const client = this.createEvolutionClient(resolved.whatsapp);
    let lastError: AxiosError<unknown> | null = null;

    for (const attempt of attempts) {
      try {
        const response = await client.request({
          method: attempt.method,
          url: attempt.path,
        });
        return response.data;
      } catch (error) {
        const axiosError = error as AxiosError<unknown>;
        lastError = axiosError;

        if (axiosError.response?.status === 404) {
          continue;
        }
      }
    }

    this.logger.error(
      JSON.stringify({
        event: 'whatsapp_channel_request_failed',
        configId: resolved.config.id,
        instanceName: resolved.whatsapp.instanceName,
        status: lastError?.response?.status,
        response: lastError?.response?.data,
      }),
      lastError instanceof Error ? lastError.stack : undefined,
    );

    throw new HttpException(
      'No se pudo consultar la instancia en Evolution API',
      HttpStatus.BAD_GATEWAY,
    );
  }

  private extractConnectionStatus(payload: unknown): string {
    const record = this.asRecord(payload);
    const instance = this.asRecord(record.instance);
    const instanceStatus = this.asRecord(instance.status);
    const data = this.asRecord(record.data);
    const dataInstance = this.asRecord(data.instance);

    return (
      this.pickString([
        record.status,
        record.state,
        record.connectionStatus,
        instance.state,
        instance.status,
        instance.connectionStatus,
        instanceStatus.status,
        instanceStatus.state,
        data.status,
        data.state,
        data.connectionStatus,
        dataInstance.status,
        dataInstance.state,
      ]) ?? 'unknown'
    );
  }

  private extractConnectedFlag(payload: unknown, status: string): boolean {
    const normalizedStatus = status.toLowerCase();
    if (
      normalizedStatus.includes('open') ||
      normalizedStatus.includes('connected') ||
      normalizedStatus.includes('online')
    ) {
      return true;
    }

    const record = this.asRecord(payload);
    const instance = this.asRecord(record.instance);
    const data = this.asRecord(record.data);
    const dataInstance = this.asRecord(data.instance);

    return this.pickBoolean([
      record.connected,
      record.open,
      record.isConnected,
      instance.connected,
      instance.open,
      instance.isConnected,
      data.connected,
      data.open,
      data.isConnected,
      dataInstance.connected,
      dataInstance.open,
      dataInstance.isConnected,
    ]);
  }

  private extractQrData(payload: unknown): {
    qrCode: string | null;
    qrCodeBase64: string | null;
  } {
    const record = this.asRecord(payload);
    const qrcode = this.asRecord(record.qrcode);
    const qr = this.asRecord(record.qr);
    const data = this.asRecord(record.data);
    const dataQrCode = this.asRecord(data.qrcode);

    return {
      qrCode:
        this.pickString([
          record.code,
          record.qrCode,
          record.pairingCode,
          qrcode.code,
          qrcode.text,
          qrcode.string,
          qr.code,
          qr.text,
          data.code,
          data.qrCode,
          dataQrCode.code,
          dataQrCode.text,
        ]) ?? null,
      qrCodeBase64:
        this.normalizeBase64(
          this.pickString([
            record.base64,
            record.qrCodeBase64,
            qrcode.base64,
            qrcode.image,
            qrcode.base64Image,
            qr.base64,
            qr.image,
            data.base64,
            data.qrCodeBase64,
            dataQrCode.base64,
            dataQrCode.image,
          ]),
        ) ?? null,
    };
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

  private normalizeBase64(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    if (!value.includes(',')) {
      return value.trim();
    }

    const parts = value.split(',');
    return parts[parts.length - 1]?.trim();
  }

  private pickString(values: unknown[]): string | undefined {
    for (const value of values) {
      const next = this.asString(value);
      if (next) {
        return next;
      }
    }

    return undefined;
  }

  private pickBoolean(values: unknown[]): boolean {
    for (const value of values) {
      if (typeof value === 'boolean') {
        return value;
      }
    }

    return false;
  }

  private asRecord(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null ? (value as JsonRecord) : {};
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}

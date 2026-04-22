import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaFile, WhatsAppInstance } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';
import { BotService } from '../bot/bot.service';
import { ClientConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { VoiceService } from './voice.service';
import {
  ManagedWhatsAppInstance,
  NormalizedIncomingWhatsAppMessage,
  ResolvedWhatsAppClient,
  WebhookProcessingResult,
  WhatsAppChannelStatus,
  WhatsAppClientConfiguration,
  WhatsAppInstanceRecord,
  WhatsAppQrResponse,
  WhatsAppWebhookConfigResponse,
} from './whatsapp.types';

type HeaderMap = Record<string, string | string[] | undefined>;
type JsonRecord = Record<string, unknown>;
type InstanceStatus = 'connected' | 'disconnected' | 'connecting';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly botService: BotService,
    private readonly clientConfigService: ClientConfigService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly voiceService: VoiceService,
  ) {}

  async acceptWebhook(
    payload: JsonRecord,
    headers: HeaderMap,
  ): Promise<WebhookProcessingResult> {
    const handledConnectionUpdate = await this.processConnectionUpdate(payload);
    if (handledConnectionUpdate) {
      return { ok: true, accepted: true };
    }

    if (!this.looksLikeMessageWebhook(payload)) {
      return { ok: true, ignored: true };
    }

    void this.processMessageWebhook(payload, headers).catch((error: unknown) => {
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

  async createInstance(name: string): Promise<ManagedWhatsAppInstance> {
    const instanceName = this.normalizeInstanceName(name);

    const existing = await this.prisma.whatsAppInstance.findUnique({
      where: { name: instanceName },
    });
    if (existing) {
      throw new HttpException('La instancia ya existe', HttpStatus.BAD_REQUEST);
    }

    const connectedInstance = await this.prisma.whatsAppInstance.findFirst({
      where: { status: 'connected' },
    });
    if (connectedInstance) {
      throw new HttpException(
        'Ya existe una instancia conectada',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      await this.getEvolutionClient().post('/instance/create', {
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
      });
    } catch (error) {
      this.handleEvolutionError(error, 'No fue posible crear la instancia en Evolution.');
    }

    await this.prisma.whatsAppInstance.create({
      data: {
        name: instanceName,
        status: 'connecting',
      },
    });

    return this.waitForManagedStatus(instanceName);
  }

  async getInstances(): Promise<ManagedWhatsAppInstance[]> {
    await this.syncInstancesFromEvolution();

    const instances = await this.prisma.whatsAppInstance.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(instances.map((instance) => this.toManagedInstance(instance)));
  }

  async getInstanceStatus(name: string): Promise<ManagedWhatsAppInstance> {
    const instanceName = this.normalizeInstanceName(name);
    const synced = await this.syncInstanceFromEvolution(instanceName);

    if (synced) {
      return this.toManagedInstance(synced);
    }

    const existing = await this.prisma.whatsAppInstance.findUnique({
      where: { name: instanceName },
    });
    if (!existing) {
      throw new HttpException(
        `La instancia ${instanceName} no existe`,
        HttpStatus.NOT_FOUND,
      );
    }

    const updated = await this.prisma.whatsAppInstance.update({
      where: { name: instanceName },
      data: { status: 'disconnected' },
    });

    return this.toManagedInstance(updated);
  }

  async deleteInstance(name: string): Promise<{ message: string; name: string }> {
    const instanceName = this.normalizeInstanceName(name);
    const existing = await this.prisma.whatsAppInstance.findUnique({
      where: { name: instanceName },
    });
    if (!existing) {
      throw new HttpException('La instancia no existe', HttpStatus.NOT_FOUND);
    }

    try {
      await this.getEvolutionClient().delete(`/instance/delete/${instanceName}`);
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 404) {
        this.handleEvolutionError(error, 'No fue posible eliminar la instancia en Evolution.');
      }
    }

    await this.prisma.whatsAppInstance.delete({
      where: { name: instanceName },
    });

    return {
      message: 'Instancia eliminada correctamente.',
      name: instanceName,
    };
  }

  async connectInstance(name: string): Promise<WhatsAppQrResponse> {
    return this.getQr(name);
  }

  async getQr(name: string): Promise<WhatsAppQrResponse> {
    const instanceName = this.normalizeInstanceName(name);
    const status = await this.getInstanceStatus(instanceName);

    if (status.connected) {
      return {
        instanceName,
        qrCodeBase64: null,
        status: 'connected',
        message: 'La instancia ya se encuentra conectada.',
      };
    }

    try {
      const response = await this.getEvolutionClient().get(`/instance/connect/${instanceName}`);
      const payload = this.asRecord(response.data);
      const qrCodeBase64 = this.extractQrCodeBase64(payload);

      return {
        instanceName,
        qrCodeBase64,
        status: 'disconnected',
        message: qrCodeBase64
          ? 'QR obtenido correctamente.'
          : 'No hay QR disponible para esta instancia.',
      };
    } catch (error) {
      this.handleEvolutionError(error, 'No fue posible obtener el QR de WhatsApp.');
    }
  }

  async setWebhook(
    name: string,
    webhook?: string,
    events?: string[],
  ): Promise<WhatsAppWebhookConfigResponse> {
    const instanceName = this.normalizeInstanceName(name);
    const resolved = await this.resolveConfig();
    const resolvedWebhook =
      webhook?.trim() ||
      resolved.whatsapp.webhookUrl?.trim() ||
      this.getOptionalEnv('WEBHOOK_URL') ||
      '';
    const resolvedEvents = this.normalizeWebhookEvents(events);

    if (!resolvedWebhook) {
      throw new HttpException(
        'Debes configurar la URL del webhook antes de activarlo.',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      await this.getEvolutionClient().post(`/webhook/set/${instanceName}`, {
        webhook: {
          enabled: true,
          url: resolvedWebhook,
          events: resolvedEvents,
          webhookByEvents: false,
          webhookBase64: false,
        },
      });

      return {
        instanceName,
        webhook: resolvedWebhook,
        events: resolvedEvents,
        message: 'Webhook configurado correctamente.',
      };
    } catch (error) {
      this.handleEvolutionError(error, 'No fue posible configurar el webhook.');
    }
  }

  async getStatus(name: string): Promise<WhatsAppChannelStatus> {
    const instance = await this.getInstanceStatus(name);
    const qr = instance.connected
      ? {
          qrCodeBase64: null,
        }
      : await this.getQr(name);

    return {
      provider: 'evolution',
      instanceName: instance.name,
      status: instance.status,
      connected: instance.connected,
      qrCode: qr.qrCodeBase64,
      qrCodeBase64: qr.qrCodeBase64,
      details: {
        id: instance.id,
        phone: instance.phone,
      },
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

  async sendVideo(
    resolved: ResolvedWhatsAppClient,
    to: string,
    videoUrl: string,
    caption = '',
  ): Promise<void> {
    await this.executeEvolutionRequest(
      resolved,
      'sendVideo',
      `/message/sendMedia/${resolved.whatsapp.instanceName}`,
      {
        number: this.normalizeNumber(to),
        mediatype: 'video',
        mimetype: 'video/mp4',
        media: videoUrl,
        caption,
        fileName: 'video.mp4',
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

  private async processConnectionUpdate(payload: JsonRecord): Promise<boolean> {
    const event = this.asString(payload.event)?.toLowerCase();
    if (event !== 'connection.update') {
      return false;
    }

    const eventData = this.asRecord(payload.data);
    const instanceName = this.readInstanceName(payload) || this.readInstanceName(eventData);
    if (!instanceName) {
      return true;
    }

    await this.upsertInstanceRecord(
      instanceName,
      this.readInstanceStatus(eventData),
      this.extractPhone(eventData),
    );

    return true;
  }

  private looksLikeMessageWebhook(payload: JsonRecord): boolean {
    const data = this.asRecord(payload.data);
    return (
      Object.keys(this.asRecord(data.message)).length > 0 ||
      Boolean(this.asString(payload.sender) || this.asString(payload.from))
    );
  }

  private async processMessageWebhook(payload: JsonRecord, headers: HeaderMap): Promise<void> {
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

    let botReply: Awaited<ReturnType<BotService['processIncomingMessage']>>;
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

    if (botReply.mediaFiles.length > 0) {
      await this.deliverMatchedMedia(resolved, contactId, botReply.mediaFiles, botReply.reply);
      return;
    }

    if (
      botReply.replyType === 'audio' &&
      (resolved.config.botSettings?.allowAudioReplies ?? true)
    ) {
      try {
        const audio = await this.voiceService.generateVoice(
          botReply.reply,
          resolved.config.elevenlabsKey ?? '',
          resolved.whatsapp.audioVoiceId,
          resolved.whatsapp.elevenLabsBaseUrl,
        );

        await this.sendAudio(resolved, contactId, audio);
        return;
      } catch (error) {
        this.logger.error(
          JSON.stringify({
            event: 'voice_generation_failed',
            contactId,
          }),
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    await this.sendText(resolved, contactId, botReply.reply);
  }

  private async deliverMatchedMedia(
    resolved: ResolvedWhatsAppClient,
    contactId: string,
    mediaFiles: MediaFile[],
    message: string,
  ): Promise<void> {
    for (const [index, media] of mediaFiles.entries()) {
      const caption = index === 0 ? message : media.title;

      if (media.fileType === 'video') {
        await this.sendVideo(resolved, contactId, media.fileUrl, caption);
        continue;
      }

      await this.sendImage(resolved, contactId, media.fileUrl, caption);
    }
  }

  private async resolveConfig(): Promise<ResolvedWhatsAppClient> {
    const config = await this.clientConfigService.getConfig();

    return {
      config,
      whatsapp: this.extractWhatsAppConfiguration(config),
    };
  }

  private async syncInstancesFromEvolution(): Promise<void> {
    const remoteInstances = await this.fetchEvolutionInstances();

    for (const remote of remoteInstances) {
      const remoteData = this.asRecord(remote);
      const name = this.readInstanceName(remoteData);
      if (!name) {
        continue;
      }

      await this.upsertInstanceRecord(
        name,
        this.readInstanceStatus(remoteData),
        this.extractPhone(remoteData),
      );
    }

    const remoteNames = new Set(
      remoteInstances
        .map((remote) => this.readInstanceName(this.asRecord(remote)))
        .filter((name) => name.length > 0),
    );

    const localInstances = await this.prisma.whatsAppInstance.findMany();
    for (const instance of localInstances) {
      if (!remoteNames.has(instance.name) && instance.status !== 'disconnected') {
        await this.prisma.whatsAppInstance.update({
          where: { id: instance.id },
          data: { status: 'disconnected' },
        });
      }
    }
  }

  private async syncInstanceFromEvolution(name: string): Promise<WhatsAppInstance | null> {
    const remoteInstances = await this.fetchEvolutionInstances();
    const remote = remoteInstances.find(
      (item) => this.readInstanceName(this.asRecord(item)) === name,
    );

    if (!remote) {
      return null;
    }

    return this.upsertInstanceRecord(
      name,
      this.readInstanceStatus(this.asRecord(remote)),
      this.extractPhone(this.asRecord(remote)),
    );
  }

  private async fetchEvolutionInstances(): Promise<unknown[]> {
    try {
      const response = await this.getEvolutionClient().get('/instance/fetchInstances');
      return this.extractInstances(response.data);
    } catch (error) {
      this.handleEvolutionError(error, 'No fue posible consultar las instancias en Evolution.');
    }
  }

  private async upsertInstanceRecord(
    name: string,
    status: InstanceStatus,
    phone: string | null,
  ): Promise<WhatsAppInstance> {
    return this.prisma.whatsAppInstance.upsert({
      where: { name },
      create: {
        name,
        status,
        phone,
      },
      update: {
        status,
        phone,
      },
    });
  }

  private async waitForManagedStatus(name: string, attempts = 5): Promise<ManagedWhatsAppInstance> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const synced = await this.syncInstanceFromEvolution(name);
      if (synced) {
        return this.toManagedInstance(synced);
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    const instance = await this.prisma.whatsAppInstance.findUnique({
      where: { name },
    });
    if (!instance) {
      throw new HttpException('La instancia no pudo inicializarse.', HttpStatus.BAD_GATEWAY);
    }

    return this.toManagedInstance(instance);
  }

  private async toManagedInstance(instance: WhatsAppInstanceRecord): Promise<ManagedWhatsAppInstance> {
    const webhookConfig = await this.getConfiguredWebhookMetadata();
    return {
      id: instance.id,
      name: instance.name,
      status: instance.status as InstanceStatus,
      phone: instance.phone,
      connected: instance.status === 'connected',
      webhookReady:
        webhookConfig.webhookSecretConfigured &&
        webhookConfig.webhookUrl.length > 0 &&
        webhookConfig.instanceName == instance.name,
      webhookTarget: webhookConfig.webhookUrl.length > 0 ? webhookConfig.webhookUrl : null,
      createdAt: instance.createdAt.toISOString(),
      updatedAt: instance.updatedAt.toISOString(),
    };
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

    return {
      webhookSecret:
        persisted?.webhookSecret?.trim() || this.asString(whatsapp.webhookSecret) || '',
      webhookUrl: this.asString(whatsapp.webhookUrl),
      apiBaseUrl: persisted?.apiBaseUrl?.trim() || this.asString(whatsapp.apiBaseUrl) || '',
      apiKey: persisted?.apiKey?.trim() || this.asString(whatsapp.apiKey) || '',
      instanceName:
        persisted?.instanceName?.trim() || this.asString(whatsapp.instanceName) || '',
      fallbackMessage:
        persisted?.fallbackMessage?.trim() || this.asString(whatsapp.fallbackMessage),
      audioVoiceId:
        persisted?.audioVoiceId?.trim() || this.asString(whatsapp.audioVoiceId),
      elevenLabsBaseUrl:
        persisted?.elevenLabsBaseUrl?.trim() || this.asString(elevenLabs.baseUrl),
    };
  }

  private validateWebhook(headers: HeaderMap, whatsapp: WhatsAppClientConfiguration): void {
    const expectedSecret = whatsapp.webhookSecret?.trim();
    if (!expectedSecret) {
      return;
    }

    const providedSecret = this.readHeader(headers, 'x-webhook-secret');
    if (providedSecret && providedSecret !== expectedSecret) {
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

  private detectMessageType(message: JsonRecord, messageType?: string): 'text' | 'image' | 'audio' {
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

    return (
      this.asString(message.conversation) ||
      this.asString(extendedTextMessage.text) ||
      this.asString(imageMessage.caption) ||
      this.asString(videoMessage.caption) ||
      ''
    );
  }

  private executeEvolutionRequest(
    resolved: ResolvedWhatsAppClient,
    action: 'sendText' | 'sendImage' | 'sendAudio' | 'sendVideo',
    path: string,
    body: JsonRecord,
  ): Promise<void> {
    return this.createEvolutionClient(resolved.whatsapp).post(path, body).then(
      () => undefined,
      (error: unknown) => {
        this.handleEvolutionError(error, `Evolution API ${action} failed`);
      },
    );
  }

  private createEvolutionClient(whatsapp: WhatsAppClientConfiguration): AxiosInstance {
    return axios.create({
      baseURL: whatsapp.apiBaseUrl.replace(/\/+$/, ''),
      timeout: 20000,
      headers: {
        apikey: whatsapp.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  private getEvolutionClient(): AxiosInstance {
    return axios.create({
      baseURL: this.getRequiredEnv('EVOLUTION_URL').replace(/\/+$/, ''),
      headers: {
        apikey: this.getRequiredEnv('AUTHENTICATION_API_KEY'),
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    });
  }

  private extractInstances(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
      return payload;
    }

    const data = this.asRecord(payload);
    const value = data.value ?? data.instances ?? data.data ?? data.response;
    return Array.isArray(value) ? value : [];
  }

  private readInstanceName(data: JsonRecord): string {
    const instance = this.asRecord(data.instance);
    const instanceData = this.asRecord(data.instanceData);

    return (
      this.asString(data.instanceName) ||
      this.asString(data.name) ||
      this.asString(instance.instanceName) ||
      this.asString(instance.name) ||
      this.asString(instanceData.instanceName) ||
      this.asString(instanceData.name) ||
      ''
    );
  }

  private readInstanceStatus(data: JsonRecord): InstanceStatus {
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

    if (
      rawStatus === 'open' ||
      rawStatus === 'opened' ||
      rawStatus === 'connected' ||
      rawStatus === 'online'
    ) {
      return 'connected';
    }

    if (
      rawStatus === 'connecting' ||
      rawStatus === 'pairing' ||
      rawStatus === 'qrcode' ||
      rawStatus === 'qr' ||
      rawStatus === 'scan qr' ||
      rawStatus === 'scan_qr'
    ) {
      return 'connecting';
    }

    return 'disconnected';
  }

  private normalizeWebhookEvents(events?: string[]): string[] {
    const source = events?.length ? events : ['messages.upsert', 'connection.update'];

    return source.map((event) => {
      const normalized = event.trim();
      if (normalized.toLowerCase() === 'messages.upsert') {
        return 'MESSAGES_UPSERT';
      }

      if (normalized.toLowerCase() === 'connection.update') {
        return 'CONNECTION_UPDATE';
      }

      return normalized;
    });
  }

  private extractPhone(data: JsonRecord): string | null {
    const instance = this.asRecord(data.instance);
    const instanceData = this.asRecord(data.instanceData);

    return (
      this.asString(data.number) ||
      this.asString(data.phone) ||
      this.asString(instance.number) ||
      this.asString(instance.phone) ||
      this.asString(instanceData.number) ||
      this.asString(instanceData.phone) ||
      null
    );
  }

  private extractQrCodeBase64(payload: JsonRecord): string | null {
    const qrcode = this.asRecord(payload.qrcode);
    const qr = this.asRecord(payload.qr);
    const base64 =
      this.asString(payload.base64) ||
      this.asString(payload.qrCodeBase64) ||
      this.asString(qrcode.base64) ||
      this.asString(qrcode.image) ||
      this.asString(qr.base64) ||
      this.asString(qr.image);

    return base64?.trim() ? base64.trim() : null;
  }

  private readHeader(headers: HeaderMap, headerName: string): string | undefined {
    const value = headers[headerName] ?? headers[headerName.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  private hasNestedObject(record: JsonRecord, key: string): boolean {
    return typeof record[key] === 'object' && record[key] !== null;
  }

  private normalizeNumber(raw: string): string {
    return raw.replace(/@.*/, '').replace(/\D/g, '');
  }

  private normalizeInstanceName(name: string): string {
    const normalized = name.trim();
    if (!normalized) {
      throw new BadRequestException('El nombre de la instancia es obligatorio.');
    }

    return normalized;
  }

  private getRequiredEnv(name: 'EVOLUTION_URL' | 'AUTHENTICATION_API_KEY'): string {
    const value = this.configService.get<string>(name)?.trim();
    if (!value) {
      throw new HttpException(
        `La variable de entorno ${name} es obligatoria.`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return value;
  }

  private getOptionalEnv(name: 'WEBHOOK_URL'): string | undefined {
    return this.configService.get<string>(name)?.trim() || undefined;
  }

  private async getConfiguredWebhookMetadata(): Promise<{
    instanceName: string;
    webhookSecretConfigured: boolean;
    webhookUrl: string;
  }> {
    const config = await this.clientConfigService.getConfig();
    const configurations = this.asRecord(config.configurations);
    const whatsapp = this.asRecord(configurations.whatsapp);

    return {
      instanceName: config.whatsappSettings?.instanceName?.trim() || this.asString(whatsapp.instanceName) || '',
      webhookSecretConfigured: Boolean(
        config.whatsappSettings?.webhookSecret?.trim() || this.asString(whatsapp.webhookSecret),
      ),
      webhookUrl: this.asString(whatsapp.webhookUrl) || '',
    };
  }

  private handleEvolutionError(error: unknown, fallbackMessage: string): never {
    if (error instanceof HttpException) {
      throw error;
    }

    if (axios.isAxiosError(error)) {
      const payload = this.asRecord(error.response?.data);
      const message =
        this.asString(payload.message) ||
        this.asString(payload.error) ||
        error.message ||
        fallbackMessage;

      throw new HttpException(message, error.response?.status ?? HttpStatus.BAD_GATEWAY);
    }

    throw new HttpException(fallbackMessage, HttpStatus.BAD_GATEWAY);
  }

  private asRecord(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null ? (value as JsonRecord) : {};
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
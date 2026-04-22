import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
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
  private static readonly SHORT_AUDIO_MAX_SECONDS = 12;
  private static readonly MAX_AUDIO_DURATION_SECONDS = 60;
  private static readonly AUDIO_TRANSCRIPT_CACHE_TTL_SECONDS = 60 * 60 * 6;
  private static readonly VOICE_PREFERENCE_TTL_SECONDS = 60 * 60 * 24 * 30;
  private static readonly INBOUND_MESSAGE_DEDUP_TTL_SECONDS = 60 * 10;

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
    const webhookHeaders = resolved.whatsapp.webhookSecret?.trim()
      ? { 'x-webhook-secret': resolved.whatsapp.webhookSecret.trim() }
      : undefined;
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
          headers: webhookHeaders,
          events: resolvedEvents,
          webhookByEvents: false,
          webhookBase64: false,
        },
      });

      const remoteWebhook = await this.getEvolutionWebhookMetadata(instanceName);
      const webhookVerified = this.isWebhookVerified(remoteWebhook, resolvedWebhook);

      return {
        instanceName,
        webhook: remoteWebhook?.url || resolvedWebhook,
        events: remoteWebhook?.events.length ?? 0 > 0 ? remoteWebhook!.events : resolvedEvents,
        message: webhookVerified
          ? 'Webhook configurado y verificado en Evolution.'
          : 'Webhook enviado a Evolution, pero todavia no se pudo confirmar su activacion.',
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
    options?: {
      fileName?: string;
      mimetype?: string;
      ptt?: boolean;
    },
  ): Promise<void> {
    await this.executeEvolutionRequest(
      resolved,
      'sendAudio',
      `/message/sendWhatsAppAudio/${resolved.whatsapp.instanceName}`,
      {
        number: this.normalizeNumber(to),
        audio: Buffer.isBuffer(audio) ? audio.toString('base64') : audio,
        fileName: options?.fileName ?? 'reply.mp3',
        mimetype: options?.mimetype ?? 'audio/mpeg',
        ptt: options?.ptt ?? true,
        encoding: true,
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
    const event = this.asString(payload.event)?.toLowerCase();
    if (event && event !== 'messages.upsert') {
      return false;
    }

    const data = this.getWebhookMessageData(payload);
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

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_message_received',
        contactId: incoming.number,
        type: incoming.type,
        message: incoming.message,
      }),
    );

    if (!(await this.acquireIncomingMessageLock(incoming))) {
      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp_message_duplicate_ignored',
          contactId: incoming.number,
          messageId: incoming.messageId,
          type: incoming.type,
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

    if (incoming.type === 'audio') {
      await this.processIncomingAudioMessage(resolved, incoming);
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
    options?: {
      preferAudioReply?: boolean;
    },
  ): Promise<void> {
    const fallbackMessage =
      resolved.whatsapp.fallbackMessage ??
      'En este momento no pude procesar tu mensaje. Intenta nuevamente en unos minutos.';
    const preferAudioReply =
      options?.preferAudioReply ?? (await this.hasVoiceReplyPreference(contactId));

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
      this.logger.log(
        JSON.stringify({
          event: 'whatsapp_reply_sent',
          contactId,
          intent: botReply.intent,
          hotLead: botReply.hotLead,
          usedGallery: true,
          replyType: 'media',
        }),
      );
      return;
    }

    if (
      (resolved.config.botSettings?.allowAudioReplies ?? true) &&
      (botReply.replyType === 'audio' || preferAudioReply)
    ) {
      try {
        const audio = await this.voiceService.generateVoice({
          text: botReply.reply,
          openAiKey: resolved.config.openaiKey,
          elevenLabsKey: resolved.config.elevenlabsKey ?? undefined,
          voiceId: resolved.whatsapp.audioVoiceId,
          baseUrl: resolved.whatsapp.elevenLabsBaseUrl,
        });

        await this.sendAudioWithRetry(resolved, contactId, audio.buffer, {
          fileName: audio.fileName,
          mimetype: audio.mimetype,
          ptt: true,
        });
        this.logger.log(
          JSON.stringify({
            event: 'whatsapp_reply_sent',
            contactId,
            intent: botReply.intent,
            hotLead: botReply.hotLead,
            usedGallery: false,
            replyType: 'audio',
          }),
        );
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
    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_reply_sent',
        contactId,
        intent: botReply.intent,
        hotLead: botReply.hotLead,
        usedGallery: false,
        replyType: 'text',
      }),
    );
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

  private async processIncomingAudioMessage(
    resolved: ResolvedWhatsAppClient,
    incoming: NormalizedIncomingWhatsAppMessage,
  ): Promise<void> {
    const durationSeconds = incoming.audio?.seconds;

    try {
      if (
        typeof durationSeconds === 'number' &&
        durationSeconds > WhatsAppService.MAX_AUDIO_DURATION_SECONDS
      ) {
        await this.sendText(
          resolved,
          incoming.number,
          'Tu nota de voz supera los 60 segundos. Enviamela mas corta, por favor.',
        );
        return;
      }

      const transcript = await this.getOrCreateAudioTranscript(resolved, incoming);
      if (!transcript) {
        await this.sendText(
          resolved,
          incoming.number,
          'No pude entender tu nota de voz. Si puedes, mandamela otra vez o escribeme.',
        );
        return;
      }

      this.logger.log(
        JSON.stringify({
          event: 'whatsapp_audio_transcribed',
          contactId: incoming.number,
          pushName: incoming.pushName,
          seconds: durationSeconds ?? null,
          transcript,
        }),
      );

      await this.processAndDeliverMessage(resolved, incoming.number, transcript, 'audio', {
        preferAudioReply: this.shouldReplyWithVoiceForAudio(incoming),
      });
      await this.rememberVoiceReplyPreference(incoming.number);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'audio_processing_failed',
          contactId: incoming.number,
          messageId: incoming.messageId,
        }),
        error instanceof Error ? error.stack : undefined,
      );

      await this.sendText(
        resolved,
        incoming.number,
        'No pude procesar tu audio ahora mismo. Si quieres, escribeme el mensaje.',
      );
    }
  }

  private async acquireIncomingMessageLock(
    incoming: NormalizedIncomingWhatsAppMessage,
  ): Promise<boolean> {
    if (!incoming.messageId?.trim()) {
      return true;
    }

    try {
      return await this.redisService.setIfAbsent(
        this.getIncomingMessageDedupKey(incoming),
        '1',
        WhatsAppService.INBOUND_MESSAGE_DEDUP_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp_message_dedup_unavailable',
          contactId: incoming.number,
          messageId: incoming.messageId,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
      return true;
    }
  }

  private async getOrCreateAudioTranscript(
    resolved: ResolvedWhatsAppClient,
    incoming: NormalizedIncomingWhatsAppMessage,
  ): Promise<string> {
    const cacheKey = this.getAudioTranscriptCacheKey(incoming);
    const cached = await this.redisService.get<string>(cacheKey);
    if (cached?.trim()) {
      return cached.trim();
    }

    const downloadedAudio = await this.downloadMediaMessage(resolved, incoming);
    const transcript = await this.voiceService.transcribeAudio(
      downloadedAudio.buffer,
      resolved.config.openaiKey,
      downloadedAudio.fileName,
      downloadedAudio.mimetype,
    );

    await this.redisService.set(
      cacheKey,
      transcript,
      WhatsAppService.AUDIO_TRANSCRIPT_CACHE_TTL_SECONDS,
    );

    return transcript;
  }

  private async downloadMediaMessage(
    resolved: ResolvedWhatsAppClient,
    incoming: NormalizedIncomingWhatsAppMessage,
  ): Promise<{ buffer: Buffer; fileName: string; mimetype: string }> {
    const audio = incoming.audio;
    if (!audio) {
      throw new BadRequestException('Incoming audio metadata is missing');
    }

    if (audio.base64) {
      return {
        buffer: Buffer.from(audio.base64, 'base64'),
        fileName: this.buildAudioFileName(incoming.messageId, audio.mimetype),
        mimetype: audio.mimetype || 'audio/ogg',
      };
    }

    if (audio.mediaUrl) {
      return this.downloadAudioFromUrl(audio.mediaUrl, incoming, audio.mimetype);
    }

    const requestBody = {
      message: this.buildEvolutionMediaPayload(incoming),
    };

    try {
      const response = await this.createEvolutionClient(resolved.whatsapp).post(
        `/chat/getBase64FromMediaMessage/${resolved.whatsapp.instanceName}`,
        requestBody,
      );
      const payload = this.asRecord(response.data);
      const nested = this.asRecord(payload.data);
      const base64 = this.asString(payload.base64) || this.asString(nested.base64);

      if (!base64) {
        throw new BadRequestException('Evolution did not return audio base64');
      }

      return {
        buffer: Buffer.from(base64, 'base64'),
        fileName:
          this.asString(payload.fileName) ||
          this.asString(nested.fileName) ||
          this.buildAudioFileName(incoming.messageId, audio.mimetype),
        mimetype:
          this.asString(payload.mimetype) ||
          this.asString(nested.mimetype) ||
          audio.mimetype ||
          'audio/ogg',
      };
    } catch (error) {
      if (audio.mediaUrl) {
        return this.downloadAudioFromUrl(audio.mediaUrl, incoming, audio.mimetype);
      }

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException('Audio media download failed', HttpStatus.BAD_GATEWAY);
    }
  }

  private async downloadAudioFromUrl(
    mediaUrl: string,
    incoming: NormalizedIncomingWhatsAppMessage,
    mimetype?: string,
  ): Promise<{ buffer: Buffer; fileName: string; mimetype: string }> {
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 45000,
    });

    return {
      buffer: Buffer.from(response.data),
      fileName: this.buildAudioFileName(incoming.messageId, mimetype),
      mimetype: this.asString(response.headers['content-type']) || mimetype || 'audio/ogg',
    };
  }

  private buildEvolutionMediaPayload(
    incoming: NormalizedIncomingWhatsAppMessage,
  ): Record<string, unknown> {
    const data = this.getWebhookMessageData(this.asRecord(incoming.rawPayload));
    const key = this.asRecord(data.key);
    const message = this.asRecord(data.message);

    if (!Object.keys(key).length || !Object.keys(message).length) {
      throw new BadRequestException('Webhook audio payload is incomplete');
    }

    return {
      key,
      message,
      messageType: this.asString(data.messageType) || 'audioMessage',
    };
  }

  private getWebhookMessageData(payload: JsonRecord): JsonRecord {
    const data = this.asRecord(payload.data);

    if (
      Object.keys(this.asRecord(data.message)).length > 0 ||
      Object.keys(this.asRecord(data.key)).length > 0
    ) {
      return data;
    }

    return payload;
  }

  private buildAudioFileName(messageId: string | null, mimetype?: string): string {
    const extension = this.getAudioExtension(mimetype);
    return `${messageId || 'audio'}.${extension}`;
  }

  private getAudioExtension(mimetype?: string): string {
    const normalized = mimetype?.toLowerCase() || '';

    if (normalized.includes('mpeg') || normalized.includes('mp3')) {
      return 'mp3';
    }

    if (normalized.includes('wav')) {
      return 'wav';
    }

    if (normalized.includes('ogg') || normalized.includes('opus')) {
      return 'ogg';
    }

    return 'ogg';
  }

  private shouldReplyWithVoiceForAudio(
    incoming: NormalizedIncomingWhatsAppMessage,
  ): boolean {
    const durationSeconds = incoming.audio?.seconds;

    if (typeof durationSeconds === 'number') {
      return durationSeconds > WhatsAppService.SHORT_AUDIO_MAX_SECONDS;
    }

    return Boolean(incoming.audio?.ptt || incoming.audio);
  }

  private async sendAudioWithRetry(
    resolved: ResolvedWhatsAppClient,
    to: string,
    audio: Buffer | string,
    options?: {
      fileName?: string;
      mimetype?: string;
      ptt?: boolean;
    },
  ): Promise<void> {
    try {
      await this.sendAudio(resolved, to, audio, options);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp_audio_retry',
          contactId: to,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
      await this.sendAudio(resolved, to, audio, options);
    }
  }

  private async rememberVoiceReplyPreference(contactId: string): Promise<void> {
    await this.redisService.set(
      this.getVoiceReplyPreferenceKey(contactId),
      '1',
      WhatsAppService.VOICE_PREFERENCE_TTL_SECONDS,
    );
  }

  private async hasVoiceReplyPreference(contactId: string): Promise<boolean> {
    return (await this.redisService.get<string>(this.getVoiceReplyPreferenceKey(contactId))) === '1';
  }

  private getVoiceReplyPreferenceKey(contactId: string): string {
    return `voice-pref:${this.normalizeNumber(contactId)}`;
  }

  private getIncomingMessageDedupKey(
    incoming: NormalizedIncomingWhatsAppMessage,
  ): string {
    return `wa-inbound:${this.normalizeNumber(incoming.number)}:${incoming.messageId}`;
  }

  private getAudioTranscriptCacheKey(
    incoming: NormalizedIncomingWhatsAppMessage,
  ): string {
    const parts = [
      incoming.messageId,
      incoming.number,
      incoming.audio?.directPath,
      incoming.audio?.mediaKey,
      incoming.audio?.mediaUrl,
    ].filter((value): value is string => Boolean(value && value.trim()));

    const rawSignature =
      parts.join(':') || JSON.stringify(this.asRecord(this.asRecord(incoming.rawPayload).data));

    return `audio-stt:${createHash('sha1').update(rawSignature).digest('hex')}`;
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
    const [webhookConfig, evolutionWebhook] = await Promise.all([
      this.getConfiguredWebhookMetadata(),
      this.getEvolutionWebhookMetadata(instance.name),
    ]);
    const expectedWebhookUrl =
      webhookConfig.instanceName === instance.name ? webhookConfig.webhookUrl : '';
    const webhookTarget = evolutionWebhook?.url || expectedWebhookUrl || null;

    return {
      id: instance.id,
      name: instance.name,
      status: instance.status as InstanceStatus,
      phone: instance.phone,
      connected: instance.status === 'connected',
      webhookReady: this.isWebhookVerified(evolutionWebhook, expectedWebhookUrl),
      webhookTarget,
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
    if (!providedSecret || providedSecret !== expectedSecret) {
      throw new HttpException('Invalid webhook secret', HttpStatus.UNAUTHORIZED);
    }
  }

  private normalizeWebhookPayload(
    payload: JsonRecord,
  ): NormalizedIncomingWhatsAppMessage | null {
    const event = typeof payload.event === 'string' ? payload.event : undefined;
    if (event && event.toLowerCase() !== 'messages.upsert') {
      return null;
    }

    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);
    const message = this.asRecord(data.message);
    const fromMe = Boolean(key.fromMe ?? data.fromMe);
    const pushName = this.asString(data.pushName);

    if (!Object.keys(message).length || fromMe) {
      return null;
    }

    const number = this.normalizeNumber(this.resolveIncomingRecipient(payload, data, key));

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
      pushName,
      message: type === 'text' ? text : text || `[${type}]`,
      type,
      messageId: this.asString(key.id) ?? this.asString(data.messageId) ?? null,
      audio: type === 'audio' ? this.extractAudioMetadata(message) : undefined,
      rawPayload: payload,
    };
  }

  private extractAudioMetadata(message: JsonRecord) {
    const audioMessage = this.asRecord(message.audioMessage);
    if (!Object.keys(audioMessage).length) {
      return undefined;
    }

    return {
      base64: this.asString(audioMessage.base64) || this.asString(message.base64),
      mediaUrl:
        this.asString(audioMessage.mediaUrl) ||
        this.asString(audioMessage.url) ||
        this.asString(message.mediaUrl),
      mediaKey:
        this.asString(audioMessage.mediaKey) || this.stringifyScalar(audioMessage.mediaKey),
      directPath: this.asString(audioMessage.directPath),
      mimetype: this.asString(audioMessage.mimetype) || 'audio/ogg; codecs=opus',
      seconds: this.asPositiveInteger(
        audioMessage.seconds ?? audioMessage.duration ?? audioMessage.secondsDuration,
      ),
      ptt: this.asBooleanValue(audioMessage.ptt),
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
        this.logger.error(
          JSON.stringify({
            event: 'evolution_request_failed',
            action,
            instanceName: resolved.whatsapp.instanceName,
            path,
            number: this.asString(body.number) || null,
            mediatype: this.asString(body.mediatype) || null,
          }),
        );
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

  private resolveIncomingRecipient(
    payload: JsonRecord,
    data: JsonRecord,
    key: JsonRecord,
  ): string {
    const remoteJid = this.asString(key.remoteJid) || this.asString(data.remoteJid) || '';
    const remoteJidAlt =
      this.asString(key.remoteJidAlt) ||
      this.asString(data.remoteJidAlt) ||
      this.asString(payload.remoteJidAlt) ||
      '';

    if (remoteJid.includes('@lid') && remoteJidAlt) {
      return remoteJidAlt;
    }

    return remoteJid || this.asString(payload.sender) || this.asString(payload.from) || '';
  }

  private normalizeNumber(raw: string): string {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) {
      return '';
    }

    if (
      normalized === 'status@broadcast' ||
      normalized.includes('@lid') ||
      normalized.includes('@g.us') ||
      normalized.includes('@broadcast')
    ) {
      return normalized;
    }

    return normalized.replace(/@.*/, '').replace(/\D/g, '');
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

  private async getEvolutionWebhookMetadata(instanceName: string): Promise<{
    enabled: boolean;
    url: string;
    events: string[];
  } | null> {
    try {
      const response = await this.getEvolutionClient().get(`/webhook/find/${instanceName}`);
      return this.extractEvolutionWebhookMetadata(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 404 || status === 400) {
          return null;
        }

        this.logger.warn(
          `Webhook lookup failed for ${instanceName}: ${error.message}`,
        );
        return null;
      }

      this.logger.warn(
        `Webhook lookup failed for ${instanceName}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      return null;
    }
  }

  private extractEvolutionWebhookMetadata(payload: unknown): {
    enabled: boolean;
    url: string;
    events: string[];
  } | null {
    const record = this.asRecord(payload);
    const webhook = this.asRecord(record.webhook);
    const source = Object.keys(webhook).length > 0 ? webhook : record;
    const url = this.asString(source.url) || this.asString(source.webhookUrl) || '';
    const enabled = this.asBoolean(source.enabled);
    const events = this.asStringList(source.events);

    if (!enabled && !url && events.length === 0) {
      return null;
    }

    return {
      enabled,
      url,
      events,
    };
  }

  private isWebhookVerified(
    webhook: { enabled: boolean; url: string } | null,
    expectedWebhookUrl: string,
  ): boolean {
    if (!webhook?.enabled || !webhook.url) {
      return false;
    }

    if (expectedWebhookUrl && webhook.url !== expectedWebhookUrl) {
      return false;
    }

    return true;
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

  private asBoolean(value: unknown): boolean {
    return value === true;
  }

  private asStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => this.asString(item))
      .filter((item): item is string => Boolean(item));
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private asPositiveInteger(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.trunc(value);
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.trunc(parsed);
      }
    }

    return undefined;
  }

  private asBooleanValue(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
    }

    return false;
  }

  private stringifyScalar(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (Array.isArray(value) || (value && typeof value === 'object')) {
      return JSON.stringify(value);
    }

    return undefined;
  }
}
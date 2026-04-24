import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
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
type WebhookTraceContext = {
  traceId: string;
  event: string | null;
  instanceName: string | null;
  messageId: string | null;
  remoteJid: string | null;
  pushName: string | null;
  topLevelSender: string | null;
};
type DeliveryDiagnosticContext = {
  traceId?: string;
  instanceName?: string | null;
  messageId?: string | null;
  contactId?: string | null;
  messageType?: 'text' | 'image' | 'audio';
  remoteJid?: string | null;
  recipientAddress?: string | null;
  recipientNumber?: string | null;
};

@Injectable()
export class WhatsAppService implements OnModuleInit {
  private static readonly AUTO_WEBHOOK_URL =
    'https://n8n-n8n.gcdndd.easypanel.host/webhook/7e488a8b-fc78-4702-bbf4-8159f7ca094e';
  private static readonly AUTO_WEBHOOK_EVENTS = ['messages.upsert'];
  private static readonly SHORT_AUDIO_MAX_SECONDS = 12;
  private static readonly MAX_AUDIO_DURATION_SECONDS = 60;
  private static readonly AUDIO_TRANSCRIPT_CACHE_TTL_SECONDS = 60 * 60 * 6;
  private static readonly VOICE_PREFERENCE_TTL_SECONDS = 60 * 60 * 24 * 30;
  private static readonly INBOUND_MESSAGE_DEDUP_TTL_SECONDS = 60 * 10;
  private static readonly MESSAGE_JID_CORRELATION_TTL_SECONDS = 60 * 60 * 24;
  private static readonly LID_JID_MAPPING_TTL_SECONDS = 60 * 60 * 24 * 30;
  private static readonly RUNTIME_SIGNATURE = 'wa-lid-fallback-2026-04-23b';
  private static readonly DEFAULT_WEBHOOK_EVENTS = [
    'messages.upsert',
    'messages.set',
    'messages.update',
    'messages.delete',
    'messages.edited',
    'send.message',
    'contacts.set',
    'contacts.upsert',
    'contacts.update',
    'chats.set',
    'chats.upsert',
    'chats.update',
    'chats.delete',
    'presence.update',
    'connection.update',
    'groups.upsert',
    'groups.update',
    'group-participants.update',
    'call',
  ];

  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly botService: BotService,
    private readonly clientConfigService: ClientConfigService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly voiceService: VoiceService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_runtime_signature',
        signature: WhatsAppService.RUNTIME_SIGNATURE,
      }),
    );

    await this.syncConfiguredWebhookOnStartup();
  }

  async acceptWebhook(
    payload: JsonRecord,
    headers: HeaderMap,
  ): Promise<WebhookProcessingResult> {
    const trace = this.createWebhookTraceContext(payload);
    const handledConnectionUpdate = await this.processConnectionUpdate(payload);
    if (handledConnectionUpdate) {
      return { ok: true, accepted: true, traceId: trace.traceId };
    }

    if (!this.looksLikeMessageWebhook(payload)) {
      return { ok: true, ignored: true, traceId: trace.traceId };
    }

    void this.processMessageWebhook(payload, headers, trace).catch((error: unknown) => {
      this.logWebhookFailure('async_processing', error, trace);
    });

    return { ok: true, accepted: true, traceId: trace.traceId };
  }

  private async syncConfiguredWebhookOnStartup(): Promise<void> {
    try {
      const resolved = await this.resolveConfig();
      const instanceName = resolved.whatsapp.instanceName?.trim();
      const webhookUrl = resolved.whatsapp.webhookUrl?.trim();

      if (!instanceName || !webhookUrl) {
        return;
      }

      await this.setWebhook(instanceName, webhookUrl);
      this.logger.log(
        JSON.stringify({
          event: 'whatsapp_webhook_sync_applied',
          instanceName,
          webhookUrl,
        }),
      );
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp_webhook_sync_failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
    }
  }

  async createInstance(
    name: string,
    input?: { phone?: string | null },
  ): Promise<ManagedWhatsAppInstance> {
    const instanceName = this.normalizeInstanceName(name);
    const normalizedPhone = this.normalizeOptionalInstanceField(input?.phone);

    await this.syncInstancesFromEvolution();

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

    await this.prisma.whatsAppInstance.upsert({
      where: { name: instanceName },
      update: {
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      },
      create: {
        name: instanceName,
        status: 'connecting',
        phone: normalizedPhone,
      },
    });

    await this.setWebhook(instanceName);

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

    await this.clearConfiguredInstanceIfMatches(instanceName);

    return {
      message: 'Instancia eliminada correctamente.',
      name: instanceName,
    };
  }

  async updateInstanceMetadata(
    name: string,
    input: { displayName?: string; phone?: string },
  ): Promise<ManagedWhatsAppInstance> {
    const instanceName = this.normalizeInstanceName(name);
    const existing = await this.prisma.whatsAppInstance.findUnique({
      where: { name: instanceName },
    });

    if (!existing) {
      throw new HttpException('La instancia no existe', HttpStatus.NOT_FOUND);
    }

    const updated = await this.prisma.whatsAppInstance.update({
      where: { name: instanceName },
      data: {
        displayName: this.normalizeOptionalInstanceField(input.displayName),
        phone: this.normalizeOptionalInstanceField(input.phone),
      },
    });

    return this.toManagedInstance(updated);
  }

  async connectInstance(name: string): Promise<WhatsAppQrResponse> {
    const qr = await this.getQr(name);
    await this.setWebhook(name);

    return qr;
  }

  async getQr(name: string): Promise<WhatsAppQrResponse> {
    const instanceName = this.normalizeInstanceName(name);
    const status = await this.getInstanceStatus(instanceName);

    if (status.connected) {
      return {
        instanceName,
        qrCode: null,
        qrCodeBase64: null,
        status: 'connected',
        message: 'La instancia ya se encuentra conectada.',
      };
    }

    try {
      const response = await this.getEvolutionClient().get(`/instance/connect/${instanceName}`);
      const payload = this.asRecord(response.data);
      const qrCode = this.extractQrCode(payload);
      const qrCodeBase64 = this.extractQrCodeBase64(payload);

      return {
        instanceName,
        qrCode,
        qrCodeBase64,
        status: 'disconnected',
        message: qrCodeBase64 || qrCode
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
    await this.ensureWebhookInstanceExists(instanceName);

    const resolvedWebhook =
      webhook?.trim() ||
      WhatsAppService.AUTO_WEBHOOK_URL.trim();
    const requestEvents = (events?.length ? events : WhatsAppService.AUTO_WEBHOOK_EVENTS)
      .map((event) => event.trim())
      .filter((event) => event.length > 0);

    if (!resolvedWebhook) {
      throw new HttpException(
        'Debes configurar la URL del webhook antes de activarlo.',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      await this.getEvolutionClient().post(`/webhook/set/${instanceName}`, {
        url: resolvedWebhook,
        events: requestEvents,
      });
      console.log('Webhook configurado correctamente');

      const remoteWebhook = await this.getEvolutionWebhookMetadata(instanceName);
      const webhookVerified = this.isWebhookVerified(remoteWebhook, resolvedWebhook);

      return {
        instanceName,
        webhook: remoteWebhook?.url || resolvedWebhook,
        events: remoteWebhook?.events.length ?? 0 > 0 ? remoteWebhook!.events : requestEvents,
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
          qrCode: null,
          qrCodeBase64: null,
        }
      : await this.getQr(name);

    return {
      provider: 'evolution',
      instanceName: instance.name,
      status: instance.status,
      connected: instance.connected,
      qrCode: qr.qrCode,
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
    diagnostic?: DeliveryDiagnosticContext,
  ): Promise<void> {
    const instanceName = this.getRequiredInstanceName(resolved.whatsapp);
    const finalJid = this.getRequiredOutboundAddress(to);

    console.log('JID FINAL:', finalJid);
    console.log('📤 Enviando a:', finalJid);
    console.log('📦 Instancia:', instanceName);

    await this.createEvolutionClient(resolved.whatsapp)
      .post(`/message/sendText/${instanceName}`, {
        number: finalJid,
        text,
      })
      .then(
        () => undefined,
        (error: unknown) => {
          this.logDeliveryFailure('evolution_send', error, diagnostic, {
            sendAs: 'text',
            recipientAddress: finalJid,
            instanceName,
          });
          this.logger.error(
            JSON.stringify({
              event: 'evolution_request_failed',
              traceId: diagnostic?.traceId ?? null,
              action: 'sendText',
              instanceName,
              path: `/message/sendText/${instanceName}`,
              jid: finalJid,
              mediatype: null,
              hasApiBaseUrl: Boolean(resolved.whatsapp.apiBaseUrl?.trim()),
              hasApiKey: Boolean(resolved.whatsapp.apiKey?.trim()),
              status: axios.isAxiosError(error) ? error.response?.status ?? null : null,
              data: axios.isAxiosError(error) ? error.response?.data ?? null : null,
            }),
          );
          this.handleEvolutionError(error, 'Evolution API sendText failed');
        },
      );
  }

  async sendImage(
    resolved: ResolvedWhatsAppClient,
    to: string,
    imageUrl: string,
    caption = '',
    diagnostic?: DeliveryDiagnosticContext,
  ): Promise<void> {
    await this.executeEvolutionRequest(
      resolved,
      'sendImage',
      `/message/sendMedia/${resolved.whatsapp.instanceName}`,
      {
        number: to,
        mediatype: 'image',
        mimetype: 'image/jpeg',
        media: imageUrl,
        caption,
        fileName: 'image.jpg',
      },
      diagnostic,
    );
  }

  async sendVideo(
    resolved: ResolvedWhatsAppClient,
    to: string,
    videoUrl: string,
    caption = '',
    diagnostic?: DeliveryDiagnosticContext,
  ): Promise<void> {
    await this.executeEvolutionRequest(
      resolved,
      'sendVideo',
      `/message/sendMedia/${resolved.whatsapp.instanceName}`,
      {
        number: to,
        mediatype: 'video',
        mimetype: 'video/mp4',
        media: videoUrl,
        caption,
        fileName: 'video.mp4',
      },
      diagnostic,
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
    diagnostic?: DeliveryDiagnosticContext,
  ): Promise<void> {
    await this.executeEvolutionRequest(
      resolved,
      'sendAudio',
      `/message/sendWhatsAppAudio/${resolved.whatsapp.instanceName}`,
      {
        number: to,
        audio: Buffer.isBuffer(audio) ? audio.toString('base64') : audio,
        fileName: options?.fileName ?? 'reply.mp3',
        mimetype: options?.mimetype ?? 'audio/mpeg',
        ptt: options?.ptt ?? true,
        encoding: true,
      },
      diagnostic,
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
    return this.hasSupportedInboundMessage(
      this.asRecord(data.message),
      this.asString(data.messageType) || this.asString(payload.messageType),
    );
  }

  private async processMessageWebhook(
    payload: JsonRecord,
    headers: HeaderMap,
    trace: WebhookTraceContext = this.createWebhookTraceContext(payload),
  ): Promise<void> {
    console.log('🔥 RAW:', JSON.stringify(payload, null, 2));
    this.logWebhookStage('received', trace);

    const rawData = this.getWebhookMessageData(payload);
    const rawKey = this.asRecord(rawData.key);

    const resolved = await this.resolveConfig();
    this.validateWebhook(headers, resolved.whatsapp);
    const webhookInstanceName =
      this.asString(payload.instance) || resolved.whatsapp.instanceName;
    trace = this.mergeWebhookTraceContext(trace, {
      instanceName: webhookInstanceName || trace.instanceName,
    });
    this.logWebhookStage('validated', trace, {
      webhookSecretConfigured: Boolean(resolved.whatsapp.webhookSecret?.trim()),
    });
    await this.rememberSenderJidMapping(payload, webhookInstanceName);

    if (rawKey.fromMe === true || rawData.fromMe === true) {
      this.logWebhookStage('ignored', trace, { reason: 'from_me' });
      this.logger.log(
        JSON.stringify({
          event: 'whatsapp_webhook_ignored',
          traceId: trace.traceId,
          reason: 'from_me',
          messageId:
            this.asString(rawKey.id) ?? this.asString(rawData.messageId) ?? null,
          remoteJid:
            this.asString(rawKey.remoteJid) ?? this.asString(rawData.remoteJid) ?? null,
        }),
      );
      return;
    }

    const instancePhone = await this.getInstancePhoneNumber(resolved.whatsapp.instanceName);
    payload = await this.enrichWebhookPayloadFromKnownLid(payload, webhookInstanceName);
    payload = await this.enrichWebhookPayloadFromEvolution(payload, webhookInstanceName);
    payload = this.attachWebhookRoutingMetadata(payload, instancePhone);
    const recipientRouting = this.resolveWebhookRecipientRouting(payload, instancePhone);
    this.logWebhookStage('enriched', trace, {
      instancePhone: instancePhone ?? null,
      recipientAddress: recipientRouting.address,
      recipientNumber: recipientRouting.number,
    });
    if (!recipientRouting.address || !recipientRouting.number) {
      this.logWebhookDiagnostic('recipient_routing_incomplete', trace, {
        instancePhone: instancePhone ?? null,
        recipientAddress: recipientRouting.address,
        recipientNumber: recipientRouting.number,
        reasons: this.buildRoutingDiagnosticReasons(payload, instancePhone, recipientRouting),
      });
    }
    this.logPreparedWebhookPayload(payload, instancePhone, trace);

    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);

    if (key.fromMe === true || data.fromMe === true) {
      return;
    }

    let incoming = this.normalizeWebhookPayload(payload, instancePhone);
    if (!incoming) {
      this.logWebhookStage('ignored', trace, { reason: 'unsupported_or_outbound_payload' });
      this.logWebhookDiagnostic('normalize_failed', trace, {
        instancePhone: instancePhone ?? null,
        recipientAddress: recipientRouting.address,
        recipientNumber: recipientRouting.number,
        reasons: this.buildRoutingDiagnosticReasons(payload, instancePhone, recipientRouting),
      });
      this.logger.log(
        JSON.stringify({
          event: 'whatsapp_webhook_ignored',
          traceId: trace.traceId,
          reason: 'unsupported_or_outbound_payload',
        }),
      );
      return;
    }

    incoming = await this.enrichIncomingRecipientFromEvolution(
      incoming,
      resolved.whatsapp.instanceName,
      instancePhone,
    );
    const deliveryDiagnostic = this.createDeliveryDiagnostic(trace, incoming, recipientRouting);
    this.logWebhookStage('normalized', trace, {
      contactId: incoming.number,
      messageType: incoming.type,
      outboundAddress: incoming.outboundAddress || null,
    });
    if (!incoming.outboundAddress?.includes('@s.whatsapp.net')) {
      this.logWebhookDiagnostic('outbound_address_unresolved', trace, {
        contactId: incoming.number,
        messageType: incoming.type,
        outboundAddress: incoming.outboundAddress || null,
        reasons: this.buildRoutingDiagnosticReasons(
          payload,
          instancePhone,
          recipientRouting,
          incoming,
        ),
      });
    }

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_message_received',
        traceId: trace.traceId,
        contactId: incoming.number,
        senderNumber: incoming.number,
        senderAddress: incoming.outboundAddress || null,
        recipientNumber: recipientRouting.number,
        recipientAddress: recipientRouting.address,
        pushName: incoming.pushName || null,
        type: incoming.type,
        message: incoming.message,
      }),
    );

    if (!(await this.acquireIncomingMessageLock(incoming))) {
      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp_message_duplicate_ignored',
          traceId: trace.traceId,
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
        incoming.outboundAddress,
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
      await this.processIncomingAudioMessage(resolved, incoming, deliveryDiagnostic);
      return;
    }

    await this.processAndDeliverMessage(resolved, incoming.number, incoming.message, incoming.type, {
      outboundAddress: incoming.outboundAddress,
      diagnostic: deliveryDiagnostic,
    });
  }

  private async flushGroupedTextMessage(contactId: string): Promise<void> {
    const resolved = await this.resolveConfig();
    const groupedMessage = await this.redisService.consumeGroupedMessage(contactId);

    if (!groupedMessage?.message.trim()) {
      return;
    }

    await this.processAndDeliverMessage(resolved, contactId, groupedMessage.message, 'text', {
      outboundAddress: groupedMessage.outboundAddress || undefined,
    });
  }

  private async processAndDeliverMessage(
    resolved: ResolvedWhatsAppClient,
    contactId: string,
    message: string,
    messageType: 'text' | 'image' | 'audio',
    options?: {
      preferAudioReply?: boolean;
      outboundAddress?: string;
      diagnostic?: DeliveryDiagnosticContext;
    },
  ): Promise<void> {
    const fallbackMessage =
      resolved.whatsapp.fallbackMessage ??
      'En este momento no pude procesar tu mensaje. Intenta nuevamente en unos minutos.';
    const preferAudioReply =
      options?.preferAudioReply ?? (await this.hasVoiceReplyPreference(contactId));
    const outboundAddress = options?.outboundAddress?.trim() || '';
    const diagnostic = this.mergeDeliveryDiagnosticContext(options?.diagnostic, {
      contactId,
      messageType,
      recipientAddress: outboundAddress || options?.diagnostic?.recipientAddress || null,
      recipientNumber:
        this.normalizeNumber(outboundAddress || '') ||
        options?.diagnostic?.recipientNumber ||
        null,
    });

    if (!outboundAddress.includes('@s.whatsapp.net')) {
      this.logDeliveryDiagnostic('delivery_validation_failed', diagnostic, {
        outboundAddress: outboundAddress || null,
        reasons: this.buildDeliveryDiagnosticReasons(diagnostic, outboundAddress),
      });
      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp_reply_skipped_invalid_jid',
          traceId: diagnostic.traceId ?? null,
          contactId,
          outboundAddress: outboundAddress || null,
        }),
      );
      console.log('❌ No hay JID válido, se cancela respuesta');
      return;
    }

    this.logDeliveryStage('ai_processing_started', diagnostic);
    let botReply: Awaited<ReturnType<BotService['processIncomingMessage']>>;
    try {
      botReply = await this.botService.processIncomingMessage(contactId, message);
    } catch (error) {
      this.logDeliveryFailure('ai_processing', error, diagnostic);
      this.logger.error(
        JSON.stringify({
          event: 'ai_processing_failed',
          traceId: diagnostic.traceId ?? null,
          contactId,
          messageType,
        }),
        error instanceof Error ? error.stack : undefined,
      );

      await this.sendText(resolved, outboundAddress, fallbackMessage, diagnostic);
      return;
    }

    this.logDeliveryStage('ai_processing_completed', diagnostic, {
      replyType: botReply.replyType,
      mediaCount: botReply.mediaFiles.length,
      intent: botReply.intent,
      hotLead: botReply.hotLead,
    });

    if (botReply.mediaFiles.length > 0) {
      this.logDeliveryStage('evolution_send_attempt', diagnostic, {
        sendAs: 'media',
        mediaCount: botReply.mediaFiles.length,
      });
      try {
        await this.deliverMatchedMedia(
          resolved,
          outboundAddress,
          botReply.mediaFiles,
          botReply.reply,
          diagnostic,
        );
      } catch (error) {
        this.logDeliveryFailure('evolution_send', error, diagnostic, {
          sendAs: 'media',
        });
        throw error;
      }
      this.logDeliveryStage('evolution_send_completed', diagnostic, {
        sendAs: 'media',
        mediaCount: botReply.mediaFiles.length,
      });
      this.logger.log(
        JSON.stringify({
          event: 'whatsapp_reply_sent',
          traceId: diagnostic.traceId ?? null,
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

        this.logDeliveryStage('evolution_send_attempt', diagnostic, {
          sendAs: 'audio',
        });
        await this.sendAudioWithRetry(resolved, outboundAddress, audio.buffer, {
          fileName: audio.fileName,
          mimetype: audio.mimetype,
          ptt: true,
        }, diagnostic);
        this.logDeliveryStage('evolution_send_completed', diagnostic, {
          sendAs: 'audio',
        });
        this.logger.log(
          JSON.stringify({
            event: 'whatsapp_reply_sent',
            traceId: diagnostic.traceId ?? null,
            contactId,
            intent: botReply.intent,
            hotLead: botReply.hotLead,
            usedGallery: false,
            replyType: 'audio',
          }),
        );
        return;
      } catch (error) {
        this.logDeliveryFailure('voice_generation_or_send', error, diagnostic, {
          sendAs: 'audio',
        });
        this.logger.error(
          JSON.stringify({
            event: 'voice_generation_failed',
            traceId: diagnostic.traceId ?? null,
            contactId,
          }),
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    this.logDeliveryStage('evolution_send_attempt', diagnostic, {
      sendAs: 'text',
    });
    try {
      await this.sendText(resolved, outboundAddress, botReply.reply, diagnostic);
    } catch (error) {
      this.logDeliveryFailure('evolution_send', error, diagnostic, {
        sendAs: 'text',
      });
      throw error;
    }
    this.logDeliveryStage('evolution_send_completed', diagnostic, {
      sendAs: 'text',
    });
    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_reply_sent',
        traceId: diagnostic.traceId ?? null,
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
    diagnostic?: DeliveryDiagnosticContext,
  ): Promise<void> {
    for (const [index, media] of mediaFiles.entries()) {
      const caption = index === 0 ? message : media.title;

      if (media.fileType === 'video') {
        await this.sendVideo(resolved, contactId, media.fileUrl, caption, diagnostic);
        continue;
      }

      await this.sendImage(resolved, contactId, media.fileUrl, caption, diagnostic);
    }
  }

  private async processIncomingAudioMessage(
    resolved: ResolvedWhatsAppClient,
    incoming: NormalizedIncomingWhatsAppMessage,
    diagnostic?: DeliveryDiagnosticContext,
  ): Promise<void> {
    const durationSeconds = incoming.audio?.seconds;
    const outboundAddress = incoming.outboundAddress?.trim() || '';
    const mergedDiagnostic = this.mergeDeliveryDiagnosticContext(diagnostic, {
      contactId: incoming.number,
      messageType: incoming.type,
      messageId: incoming.messageId,
      recipientAddress: outboundAddress || diagnostic?.recipientAddress || null,
      recipientNumber:
        this.normalizeNumber(outboundAddress || '') || diagnostic?.recipientNumber || null,
    });

    if (!outboundAddress.includes('@s.whatsapp.net')) {
      this.logDeliveryDiagnostic('audio_delivery_validation_failed', mergedDiagnostic, {
        outboundAddress: outboundAddress || null,
        reasons: this.buildDeliveryDiagnosticReasons(mergedDiagnostic, outboundAddress),
      });
      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp_audio_reply_skipped_invalid_jid',
          traceId: mergedDiagnostic.traceId ?? null,
          contactId: incoming.number,
          outboundAddress: outboundAddress || null,
          messageId: incoming.messageId,
        }),
      );
      console.log('❌ No hay JID válido, se cancela respuesta');
      return;
    }

    try {
      if (
        typeof durationSeconds === 'number' &&
        durationSeconds > WhatsAppService.MAX_AUDIO_DURATION_SECONDS
      ) {
        await this.sendText(
          resolved,
          outboundAddress,
          'Tu nota de voz supera los 60 segundos. Enviamela mas corta, por favor.',
          mergedDiagnostic,
        );
        return;
      }

      const transcript = await this.getOrCreateAudioTranscript(resolved, incoming);
      if (!transcript) {
        await this.sendText(
          resolved,
          outboundAddress,
          'No pude entender tu nota de voz. Si puedes, mandamela otra vez o escribeme.',
          mergedDiagnostic,
        );
        return;
      }

      this.logger.log(
        JSON.stringify({
          event: 'whatsapp_audio_transcribed',
          traceId: mergedDiagnostic.traceId ?? null,
          contactId: incoming.number,
          pushName: incoming.pushName,
          seconds: durationSeconds ?? null,
          transcript,
        }),
      );

      await this.processAndDeliverMessage(resolved, incoming.number, transcript, 'audio', {
        preferAudioReply: this.shouldReplyWithVoiceForAudio(incoming),
        outboundAddress,
        diagnostic: mergedDiagnostic,
      });
      await this.rememberVoiceReplyPreference(incoming.number);
    } catch (error) {
      this.logDeliveryFailure('audio_processing', error, mergedDiagnostic);
      this.logger.error(
        JSON.stringify({
          event: 'audio_processing_failed',
          traceId: mergedDiagnostic.traceId ?? null,
          contactId: incoming.number,
          messageId: incoming.messageId,
        }),
        error instanceof Error ? error.stack : undefined,
      );

      await this.sendText(
        resolved,
        outboundAddress,
        'No pude procesar tu audio ahora mismo. Si quieres, escribeme el mensaje.',
        mergedDiagnostic,
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

    return Object.keys(data).length > 0 ? data : payload;
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
    diagnostic?: DeliveryDiagnosticContext,
  ): Promise<void> {
    try {
      await this.sendAudio(resolved, to, audio, options, diagnostic);
    } catch (error) {
      this.logDeliveryFailure('audio_send_retry', error, diagnostic, {
        recipientAddress: to,
      });
      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp_audio_retry',
          traceId: diagnostic?.traceId ?? null,
          contactId: to,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
      await this.sendAudio(resolved, to, audio, options, diagnostic);
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

  private getLidJidMappingKey(instanceName: string, lidJid: string): string {
    return `wa:lid-map:${instanceName.trim()}:${lidJid.trim().toLowerCase()}`;
  }

  private getMessageLidCorrelationKey(instanceName: string, messageId: string): string {
    return `wa:msg-lid:${instanceName.trim()}:${messageId.trim()}`;
  }

  private getMessageRealJidCorrelationKey(instanceName: string, messageId: string): string {
    return `wa:msg-real:${instanceName.trim()}:${messageId.trim()}`;
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
      displayName: instance.displayName,
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
    instancePhone?: string | null,
  ): NormalizedIncomingWhatsAppMessage | null {
    const event = typeof payload.event === 'string' ? payload.event : undefined;
    if (event && event.toLowerCase() !== 'messages.upsert') {
      return null;
    }

    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);
    const message = this.asRecord(data.message);
    const remoteJid = this.asString(key.remoteJid) || this.asString(data.remoteJid) || '';
    const fromMe = key.fromMe === true || data.fromMe === true;
    const pushName = this.asString(data.pushName);
    const textMessage =
      this.asString(message.conversation) ||
      this.asString(this.asRecord(message.extendedTextMessage).text) ||
      '';

    if (
      !Object.keys(message).length ||
      fromMe ||
      !this.hasSupportedInboundMessage(message, this.asString(data.messageType))
    ) {
      return null;
    }

    const resolvedRecipient = this.resolveSenderJid(payload, data, key, instancePhone);
    if (!resolvedRecipient.trim()) {
      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp_recipient_resolution_failed',
          instancePhone: instancePhone ?? null,
          remoteJid: remoteJid || null,
          remoteJidAlt:
            this.asString(key.remoteJidAlt) ||
            this.asString(data.remoteJidAlt) ||
            this.asString(payload.remoteJidAlt) ||
            null,
          senderPn:
            this.asString(key.senderPn) ||
            this.asString(data.senderPn) ||
            this.asString(payload.senderPn) ||
            null,
          participantPn:
            this.asString(key.participantPn) ||
            this.asString(data.participantPn) ||
            this.asString(payload.participantPn) ||
            null,
          participantAlt:
            this.asString(key.participantAlt) ||
            this.asString(data.participantAlt) ||
            this.asString(payload.participantAlt) ||
            null,
          sender:
            this.asString(key.sender) ||
            this.asString(data.sender) ||
            this.asString(payload.sender) ||
            null,
          participant:
            this.asString(key.participant) ||
            this.asString(data.participant) ||
            this.asString(payload.participant) ||
            null,
        }),
      );
      return null;
    }

    const number = this.normalizeNumber(resolvedRecipient);

    if (!number) {
      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp_recipient_resolution_empty_number',
          resolvedRecipient,
          instancePhone: instancePhone ?? null,
        }),
      );
      return null;
    }

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_recipient_resolved',
        contactId: number,
        senderNumber: number,
        senderAddress: resolvedRecipient,
        recipientNumber: this.normalizeNumber(instancePhone || '') || null,
        recipientAddress: this.normalizeJid(instancePhone || '') || null,
        pushName: pushName || null,
        resolvedRecipient,
        instancePhone: instancePhone ?? null,
        remoteJid: remoteJid || null,
        remoteJidAlt:
          this.asString(key.remoteJidAlt) ||
          this.asString(data.remoteJidAlt) ||
          this.asString(payload.remoteJidAlt) ||
          null,
        senderPn:
          this.asString(key.senderPn) ||
          this.asString(data.senderPn) ||
          this.asString(payload.senderPn) ||
          null,
        participantPn:
          this.asString(key.participantPn) ||
          this.asString(data.participantPn) ||
          this.asString(payload.participantPn) ||
          null,
        participantAlt:
          this.asString(key.participantAlt) ||
          this.asString(data.participantAlt) ||
          this.asString(payload.participantAlt) ||
          null,
        sender:
          this.asString(key.sender) ||
          this.asString(data.sender) ||
          this.asString(payload.sender) ||
          null,
        participant:
          this.asString(key.participant) ||
          this.asString(data.participant) ||
          this.asString(payload.participant) ||
          null,
      }),
    );

    const type = this.detectMessageType(message, this.asString(data.messageType));
    if (!type) {
      return null;
    }
    const text = textMessage || this.extractMessageText(message);

    if (type === 'text' && !text.trim()) {
      throw new BadRequestException('Incoming text message content is empty');
    }

    return {
      number,
      outboundAddress: resolvedRecipient,
      pushName,
      message: type === 'text' ? text : text || `[${type}]`,
      type,
      messageId: this.asString(key.id) ?? this.asString(data.messageId) ?? null,
      audio: type === 'audio' ? this.extractAudioMetadata(message) : undefined,
      rawPayload: payload,
    };
  }

  private async enrichIncomingRecipientFromEvolution(
    incoming: NormalizedIncomingWhatsAppMessage,
    instanceName: string,
    instancePhone?: string | null,
  ): Promise<NormalizedIncomingWhatsAppMessage> {
    const currentRecipient = incoming.outboundAddress?.trim() || '';
    if (!incoming.messageId?.trim() || !currentRecipient.includes('@lid')) {
      return incoming;
    }

    const enrichedRecipient = await this.resolveIncomingRecipientFromEvolutionMessage(
      instanceName,
      incoming.messageId,
      instancePhone,
    );

    if (!enrichedRecipient || enrichedRecipient === currentRecipient) {
      return incoming;
    }

    const normalizedNumber = this.normalizeNumber(enrichedRecipient);
    if (!normalizedNumber) {
      return incoming;
    }

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_recipient_enriched_from_evolution',
        messageId: incoming.messageId,
        previousRecipient: currentRecipient,
        resolvedRecipient: enrichedRecipient,
        contactId: normalizedNumber,
      }),
    );

    return {
      ...incoming,
      number: normalizedNumber,
      outboundAddress: enrichedRecipient,
    };
  }

  private async enrichWebhookPayloadFromEvolution(
    payload: JsonRecord,
    instanceName: string,
  ): Promise<JsonRecord> {
    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);
    const messageId = this.asString(key.id) ?? this.asString(data.messageId) ?? '';
    const remoteJid = this.asString(key.remoteJid) || this.asString(data.remoteJid) || '';
    const participant =
      this.asString(key.participant) ||
      this.asString(data.participant) ||
      this.asString(payload.participant) ||
      '';
    const alreadyEnriched = [
      this.asString(key.remoteJidAlt),
      this.asString(data.remoteJidAlt),
      this.asString(payload.remoteJidAlt),
      this.asString(key.senderPn),
      this.asString(data.senderPn),
      this.asString(payload.senderPn),
      this.asString(key.participantAlt),
      this.asString(data.participantAlt),
      this.asString(payload.participantAlt),
      this.asString(key.participantPn),
      this.asString(data.participantPn),
      this.asString(payload.participantPn),
    ].some((value) => Boolean(value?.trim()));

    const requiresLidEnrichment = remoteJid.includes('@lid') || participant.includes('@lid');

    if (!instanceName.trim() || !messageId.trim() || !requiresLidEnrichment || alreadyEnriched) {
      return payload;
    }

    let enrichedPayload = payload;
    const evolutionPayload = await this.findEvolutionMessagePayload(instanceName, messageId);
    if (evolutionPayload) {
      enrichedPayload = this.mergeWebhookPayloadWithSenderFields(payload, evolutionPayload);

      const enrichedData = this.getWebhookMessageData(enrichedPayload);
      const enrichedKey = this.asRecord(enrichedData.key);
      this.logger.log(
        JSON.stringify({
          event: 'whatsapp_webhook_payload_enriched',
          source: 'message_lookup',
          messageId,
          remoteJid,
          remoteJidAlt: this.asString(enrichedKey.remoteJidAlt) || null,
          senderPn: this.asString(enrichedKey.senderPn) || null,
          participantPn: this.asString(enrichedKey.participantPn) || null,
          participantAlt: this.asString(enrichedKey.participantAlt) || null,
        }),
      );
    }

    if (this.hasWebhookSenderMetadata(enrichedPayload)) {
      return enrichedPayload;
    }

    const contactPayload = await this.findEvolutionContactPayload(instanceName, enrichedPayload);
    const contactJid = contactPayload ? this.extractEvolutionContactJid(contactPayload) : '';
    if (!contactJid || contactJid.includes('@lid')) {
      return enrichedPayload;
    }

    const contactEnrichedPayload = this.mergeWebhookPayloadWithResolvedContact(
      enrichedPayload,
      contactJid,
    );
    const contactData = this.getWebhookMessageData(contactEnrichedPayload);
    const contactKey = this.asRecord(contactData.key);

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_webhook_payload_enriched',
        source: 'contact_lookup',
        messageId,
        remoteJid,
        contactRemoteJid: contactJid,
        remoteJidAlt: this.asString(contactKey.remoteJidAlt) || null,
        senderPn: this.asString(contactKey.senderPn) || null,
        participantPn: this.asString(contactKey.participantPn) || null,
        participantAlt: this.asString(contactKey.participantAlt) || null,
      }),
    );

    return contactEnrichedPayload;
  }

  private async enrichWebhookPayloadFromKnownLid(
    payload: JsonRecord,
    instanceName: string,
  ): Promise<JsonRecord> {
    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);
    const remoteJid = this.asString(key.remoteJid) || this.asString(data.remoteJid) || '';

    if (!instanceName.trim() || !remoteJid.includes('@lid') || this.hasWebhookSenderMetadata(payload)) {
      return payload;
    }

    const cachedJid = await this.getMappedSenderJid(instanceName, remoteJid);
    if (!cachedJid) {
      return payload;
    }

    const enrichedPayload = this.mergeWebhookPayloadWithResolvedContact(payload, cachedJid);
    const enrichedData = this.getWebhookMessageData(enrichedPayload);
    const enrichedKey = this.asRecord(enrichedData.key);

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_webhook_payload_enriched',
        source: 'lid_cache',
        messageId: this.asString(key.id) ?? this.asString(data.messageId) ?? null,
        remoteJid,
        contactRemoteJid: cachedJid,
        remoteJidAlt: this.asString(enrichedKey.remoteJidAlt) || null,
        senderPn: this.asString(enrichedKey.senderPn) || null,
        participantPn: this.asString(enrichedKey.participantPn) || null,
        participantAlt: this.asString(enrichedKey.participantAlt) || null,
      }),
    );

    return enrichedPayload;
  }

  private mergeWebhookPayloadWithSenderFields(
    payload: JsonRecord,
    sourcePayload: JsonRecord,
  ): JsonRecord {
    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);
    const sourceData = this.getWebhookMessageData(sourcePayload);
    const sourceKey = this.asRecord(sourceData.key);
    const mergedKey = {
      ...sourceKey,
      ...key,
      remoteJidAlt:
        this.asString(key.remoteJidAlt) ||
        this.asString(sourceKey.remoteJidAlt) ||
        this.asString(sourceData.remoteJidAlt) ||
        this.asString(sourcePayload.remoteJidAlt),
      senderPn:
        this.asString(key.senderPn) ||
        this.asString(sourceKey.senderPn) ||
        this.asString(sourceData.senderPn) ||
        this.asString(sourcePayload.senderPn),
      participantPn:
        this.asString(key.participantPn) ||
        this.asString(sourceKey.participantPn) ||
        this.asString(sourceData.participantPn) ||
        this.asString(sourcePayload.participantPn),
      participantAlt:
        this.asString(key.participantAlt) ||
        this.asString(sourceKey.participantAlt) ||
        this.asString(sourceData.participantAlt) ||
        this.asString(sourcePayload.participantAlt),
    } satisfies JsonRecord;

    const mergedData = {
      ...sourceData,
      ...data,
      key: mergedKey,
      remoteJidAlt:
        this.asString(data.remoteJidAlt) ||
        this.asString(sourceData.remoteJidAlt) ||
        this.asString(sourcePayload.remoteJidAlt),
      senderPn:
        this.asString(data.senderPn) ||
        this.asString(sourceData.senderPn) ||
        this.asString(sourcePayload.senderPn),
      participantPn:
        this.asString(data.participantPn) ||
        this.asString(sourceData.participantPn) ||
        this.asString(sourcePayload.participantPn),
      participantAlt:
        this.asString(data.participantAlt) ||
        this.asString(sourceData.participantAlt) ||
        this.asString(sourcePayload.participantAlt),
    } satisfies JsonRecord;

    return {
      ...sourcePayload,
      ...payload,
      data: mergedData,
      remoteJidAlt:
        this.asString(payload.remoteJidAlt) ||
        this.asString(sourcePayload.remoteJidAlt) ||
        this.asString(mergedData.remoteJidAlt),
      senderPn:
        this.asString(payload.senderPn) ||
        this.asString(sourcePayload.senderPn) ||
        this.asString(mergedData.senderPn),
      participantPn:
        this.asString(payload.participantPn) ||
        this.asString(sourcePayload.participantPn) ||
        this.asString(mergedData.participantPn),
      participantAlt:
        this.asString(payload.participantAlt) ||
        this.asString(sourcePayload.participantAlt) ||
        this.asString(mergedData.participantAlt),
    };
  }

  private mergeWebhookPayloadWithResolvedContact(
    payload: JsonRecord,
    contactJid: string,
  ): JsonRecord {
    const sourcePayload = {
      remoteJidAlt: contactJid,
      senderPn: contactJid,
      participantPn: contactJid,
      participantAlt: contactJid,
      data: {
        remoteJidAlt: contactJid,
        senderPn: contactJid,
        participantPn: contactJid,
        participantAlt: contactJid,
        key: {
          remoteJidAlt: contactJid,
          senderPn: contactJid,
          participantPn: contactJid,
          participantAlt: contactJid,
        },
      },
    } satisfies JsonRecord;

    return this.mergeWebhookPayloadWithSenderFields(payload, sourcePayload);
  }

  private hasWebhookSenderMetadata(payload: JsonRecord): boolean {
    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);

    return [
      this.asString(key.remoteJidAlt),
      this.asString(data.remoteJidAlt),
      this.asString(payload.remoteJidAlt),
      this.asString(key.senderPn),
      this.asString(data.senderPn),
      this.asString(payload.senderPn),
      this.asString(key.participantAlt),
      this.asString(data.participantAlt),
      this.asString(payload.participantAlt),
      this.asString(key.participantPn),
      this.asString(data.participantPn),
      this.asString(payload.participantPn),
    ].some((value) => Boolean(value?.trim()));
  }

  private async findEvolutionContactPayload(
    instanceName: string,
    payload: JsonRecord,
  ): Promise<JsonRecord | null> {
    if (!instanceName.trim() || typeof this.configService?.get !== 'function') {
      return null;
    }

    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);
    const pushName = this.asString(data.pushName) || this.asString(payload.pushName) || '';
    const remoteJid = this.asString(key.remoteJid) || this.asString(data.remoteJid) || '';
    const participant =
      this.asString(key.participant) ||
      this.asString(data.participant) ||
      this.asString(payload.participant) ||
      '';
    const lookupJid = participant || remoteJid;
    const queries: Array<Record<string, unknown>> = [];

    if (pushName) {
      queries.push({ where: { pushName }, page: 1, offset: 10 });
    }

    if (lookupJid) {
      queries.push({ where: { remoteJid: lookupJid }, page: 1, offset: 10 });
    }

    if (pushName) {
      queries.push({ page: 1, offset: 100 });
    }

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_contact_lookup_started',
        instanceName,
        pushName: pushName || null,
        remoteJid: remoteJid || null,
        participant: participant || null,
        lookupJid: lookupJid || null,
        queryCount: queries.length,
      }),
    );

    for (const query of queries) {
      try {
        const response = await this.getEvolutionClient().post(
          `/chat/findContacts/${instanceName}`,
          query,
        );
        const records = this.extractEvolutionRecords(response.data, ['contacts']);
        const match = this.pickBestEvolutionContact(records, lookupJid, pushName, remoteJid);
        if (match) {
          return match;
        }
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'whatsapp_contact_lookup_failed',
            instanceName,
            pushName: pushName || null,
            remoteJid: remoteJid || null,
            participant: participant || null,
            lookupJid: lookupJid || null,
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        );
      }
    }

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_contact_lookup_no_match',
        instanceName,
        pushName: pushName || null,
        remoteJid: remoteJid || null,
        participant: participant || null,
        lookupJid: lookupJid || null,
      }),
    );

    return null;
  }

  private async rememberSenderJidMapping(
    payload: JsonRecord,
    instanceName: string,
  ): Promise<void> {
    if (
      !instanceName.trim() ||
      typeof this.redisService?.set !== 'function' ||
      typeof this.redisService?.get !== 'function'
    ) {
      return;
    }

    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);
    const messageId = this.asString(key.id) ?? this.asString(data.messageId) ?? '';
    const remoteJid = this.asString(key.remoteJid) || this.asString(data.remoteJid) || '';
    const resolvedRealJid = this.resolveKnownRealJid(payload, data, key);

    if (remoteJid.includes('@lid') && resolvedRealJid) {
      await this.storeMappedSenderJid(instanceName, remoteJid, resolvedRealJid);
      return;
    }

    if (!messageId.trim()) {
      return;
    }

    if (remoteJid.includes('@lid')) {
      await this.redisService.set(
        this.getMessageLidCorrelationKey(instanceName, messageId),
        remoteJid,
        WhatsAppService.MESSAGE_JID_CORRELATION_TTL_SECONDS,
      );

      const correlatedRealJid = await this.redisService.get<string>(
        this.getMessageRealJidCorrelationKey(instanceName, messageId),
      );
      if (correlatedRealJid?.includes('@s.whatsapp.net')) {
        await this.storeMappedSenderJid(instanceName, remoteJid, correlatedRealJid);
      }
      return;
    }

    if (remoteJid.includes('@s.whatsapp.net')) {
      await this.redisService.set(
        this.getMessageRealJidCorrelationKey(instanceName, messageId),
        remoteJid,
        WhatsAppService.MESSAGE_JID_CORRELATION_TTL_SECONDS,
      );

      const correlatedLid = await this.redisService.get<string>(
        this.getMessageLidCorrelationKey(instanceName, messageId),
      );
      if (correlatedLid?.includes('@lid')) {
        await this.storeMappedSenderJid(instanceName, correlatedLid, remoteJid);
      }
    }
  }

  private resolveKnownRealJid(
    payload: JsonRecord,
    data: JsonRecord,
    key: JsonRecord,
  ): string {
    const candidates = [
      this.asString(key.remoteJidAlt),
      this.asString(data.remoteJidAlt),
      this.asString(payload.remoteJidAlt),
      this.asString(key.senderPn),
      this.asString(data.senderPn),
      this.asString(payload.senderPn),
      this.asString(key.participantPn),
      this.asString(data.participantPn),
      this.asString(payload.participantPn),
      this.asString(key.participantAlt),
      this.asString(data.participantAlt),
      this.asString(payload.participantAlt),
      this.asString(key.participant),
      this.asString(data.participant),
      this.asString(payload.participant),
      this.asString(key.remoteJid),
      this.asString(data.remoteJid),
    ].filter((value): value is string => Boolean(value?.trim()));

    return candidates.find((value) => value.includes('@s.whatsapp.net')) || '';
  }

  private async getMappedSenderJid(
    instanceName: string,
    lidJid: string,
  ): Promise<string | null> {
    if (
      !instanceName.trim() ||
      !lidJid.includes('@lid') ||
      typeof this.redisService?.get !== 'function'
    ) {
      return null;
    }

    const mappedJid = await this.redisService.get<string>(
      this.getLidJidMappingKey(instanceName, lidJid),
    );

    return mappedJid?.includes('@s.whatsapp.net') ? mappedJid : null;
  }

  private async storeMappedSenderJid(
    instanceName: string,
    lidJid: string,
    realJid: string,
  ): Promise<void> {
    if (
      !instanceName.trim() ||
      !lidJid.includes('@lid') ||
      !realJid.includes('@s.whatsapp.net') ||
      typeof this.redisService?.set !== 'function'
    ) {
      return;
    }

    await this.redisService.set(
      this.getLidJidMappingKey(instanceName, lidJid),
      realJid,
      WhatsAppService.LID_JID_MAPPING_TTL_SECONDS,
    );

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_lid_mapping_learned',
        instanceName,
        lidJid,
        realJid,
      }),
    );
  }

  private pickBestEvolutionContact(
    records: unknown[],
    lookupJid: string,
    pushName: string,
    remoteJid: string,
  ): JsonRecord | null {
    const candidates = records
      .map((record) => this.asRecord(record))
      .filter((record) => {
        const contactJid = this.extractEvolutionContactJid(record);
        return Boolean(
          contactJid && !contactJid.includes('@g.us') && !contactJid.includes('@broadcast'),
        );
      });

    if (!candidates.length) {
      return null;
    }

    const exactLookupMatches = lookupJid.trim()
      ? candidates.filter((record) => this.evolutionContactReferencesValue(record, lookupJid))
      : [];
    const isGroupParticipantLookup = remoteJid.includes('@g.us') && lookupJid.includes('@lid');

    const normalizedPushName = pushName.trim().toLowerCase();
    const exactDisplayNameMatches = normalizedPushName
      ? candidates.filter((record) =>
          this.getEvolutionContactNames(record).some(
            (name) => name.trim().toLowerCase() === normalizedPushName,
          ),
        )
      : [];
    const exactNameMatches = normalizedPushName
      ? candidates.filter(
          (record) =>
            (this.asString(record.pushName) || '').trim().toLowerCase() === normalizedPushName,
        )
      : [];
    const preferredExactMatches = exactNameMatches.length
      ? exactNameMatches
      : exactDisplayNameMatches;
    const exactRealJidMatches = preferredExactMatches.filter((record) => {
      const contactJid = this.extractEvolutionContactJid(record);
      return Boolean(contactJid && contactJid.includes('@s.whatsapp.net'));
    });
    const preferredCandidates = preferredExactMatches.length
      ? preferredExactMatches
      : exactLookupMatches.length
        ? exactLookupMatches
        : candidates;
    const uniqueJids = new Set(
      preferredCandidates
        .map((record) => this.extractEvolutionContactJid(record))
        .filter((value): value is string => Boolean(value)),
    );

    const uniqueExactRealJids = new Set(
      exactRealJidMatches
        .map((record) => this.extractEvolutionContactJid(record))
        .filter((value): value is string => Boolean(value)),
    );

    if (isGroupParticipantLookup && !exactLookupMatches.length && !preferredExactMatches.length) {
      return null;
    }

    if (uniqueExactRealJids.size === 1 && exactRealJidMatches.length >= 1) {
      return exactRealJidMatches[0] ?? null;
    }

    if (
      preferredCandidates.length > 1 &&
      uniqueJids.size > 1 &&
      preferredExactMatches.length > 0
    ) {
      return null;
    }

    return (
      preferredCandidates.find((record) => {
        const contactJid = this.extractEvolutionContactJid(record);
        return Boolean(contactJid && !contactJid.includes('@lid'));
      }) ||
      preferredCandidates.find((record) => {
        const contactJid = this.extractEvolutionContactJid(record);
        return Boolean(contactJid && contactJid === lookupJid);
      }) ||
      preferredCandidates[0] ||
      null
    );
  }

  private evolutionContactReferencesValue(record: JsonRecord, value: string): boolean {
    const normalizedValue = value.trim().toLowerCase();
    if (!normalizedValue) {
      return false;
    }

    const candidates = [
      this.asString(record.remoteJid),
      this.asString(record.jid),
      this.asString(record.wuid),
      this.asString(record.id),
      this.asString(record.phone),
      this.asString(record.participant),
      this.asString(record.participantPn),
      this.asString(record.participantAlt),
      this.asString(record.senderPn),
      this.asString(record.sender),
      this.asString(record.remoteJidAlt),
    ].filter((candidate): candidate is string => Boolean(candidate?.trim()));

    return candidates.some((candidate) => candidate.trim().toLowerCase() === normalizedValue);
  }

  private getEvolutionContactNames(record: JsonRecord): string[] {
    return [
      this.asString(record.pushName),
      this.asString(record.name),
      this.asString(record.profileName),
      this.asString(record.fullName),
      this.asString(record.short),
      this.asString(record.notify),
      this.asString(record.integrationName),
    ].filter((value): value is string => Boolean(value?.trim()));
  }

  private extractEvolutionContactJid(record: JsonRecord): string {
    return (
      this.asString(record.remoteJid) ||
      this.asString(record.jid) ||
      this.asString(record.wuid) ||
      this.asString(record.id) ||
      this.asString(record.phone) ||
      ''
    );
  }

  private resolveWebhookRecipientRouting(
    payload: JsonRecord,
    instancePhone?: string | null,
  ): { address: string | null; number: string | null } {
    const data = this.getWebhookMessageData(payload);
    const normalizedRecipientAddress =
      this.normalizeJid(instancePhone || '') ||
      this.normalizeJid(this.asString(data.recipientAddress) || '') ||
      this.normalizeJid(this.asString(payload.recipientAddress) || '') ||
      this.normalizeJid(this.asString(payload.sender) || '') ||
      this.normalizeJid(this.asString(payload.from) || '') ||
      null;
    const normalizedRecipientNumber =
      this.asString(data.recipientNumber) ||
      this.asString(payload.recipientNumber) ||
      this.normalizeNumber(normalizedRecipientAddress || '') ||
      null;

    return {
      address: normalizedRecipientAddress,
      number: normalizedRecipientNumber,
    };
  }

  private attachWebhookRoutingMetadata(
    payload: JsonRecord,
    instancePhone?: string | null,
  ): JsonRecord {
    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);
    const senderAddress = this.resolveIncomingRecipient(payload, data, key, instancePhone).trim();
    const senderNumber = this.normalizeNumber(senderAddress);
    const recipientRouting = this.resolveWebhookRecipientRouting(payload, instancePhone);
    const recipientAddress = recipientRouting.address || '';
    const recipientNumber = recipientRouting.number || '';
    const hasDistinctRouting = Boolean(
      senderNumber && recipientNumber && senderNumber !== recipientNumber,
    );

    if (senderNumber && recipientNumber && senderNumber === recipientNumber) {
      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp_webhook_routing_numbers_conflict',
          senderNumber,
          recipientNumber,
          senderAddress: senderAddress || null,
          recipientAddress: recipientAddress || null,
          remoteJid: this.asString(key.remoteJid) || this.asString(data.remoteJid) || null,
        }),
      );
    }

    const resolvedSenderAddress = hasDistinctRouting ? senderAddress : '';
    const resolvedSenderNumber = hasDistinctRouting ? senderNumber : '';
    const mergedData = {
      ...data,
      senderNumber: resolvedSenderNumber || null,
      senderAddress: resolvedSenderAddress || null,
      recipientNumber: recipientNumber || null,
      recipientAddress: recipientAddress || null,
    } satisfies JsonRecord;

    return {
      ...payload,
      data: mergedData,
      senderNumber: resolvedSenderNumber || null,
      senderAddress: resolvedSenderAddress || null,
      recipientNumber: recipientNumber || null,
      recipientAddress: recipientAddress || null,
    };
  }

  private logPreparedWebhookPayload(
    payload: JsonRecord,
    instancePhone?: string | null,
    trace?: WebhookTraceContext,
  ): void {
    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);
    const recipientRouting = this.resolveWebhookRecipientRouting(payload, instancePhone);
    const resolvedSenderAddress =
      this.asString(data.senderAddress) ||
      this.asString(payload.senderAddress) ||
      this.resolveIncomingRecipient(payload, data, key, instancePhone);
    const resolvedSenderNumber =
      this.asString(data.senderNumber) ||
      this.asString(payload.senderNumber) ||
      this.normalizeNumber(resolvedSenderAddress);
    const recipientAddress = recipientRouting.address;
    const recipientNumber = recipientRouting.number;

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_webhook_payload_ready',
        traceId: trace?.traceId ?? null,
        messageId: this.asString(key.id) || this.asString(data.messageId) || null,
        pushName: this.asString(data.pushName) || null,
        resolvedSenderAddress: resolvedSenderAddress || null,
        resolvedSenderNumber: resolvedSenderNumber || null,
        recipientAddress,
        recipientNumber,
        senderAndRecipientMatch:
          Boolean(resolvedSenderNumber && recipientNumber && resolvedSenderNumber === recipientNumber),
        instancePhone: instancePhone ?? null,
        remoteJid: this.asString(key.remoteJid) || this.asString(data.remoteJid) || null,
        remoteJidAlt:
          this.asString(key.remoteJidAlt) ||
          this.asString(data.remoteJidAlt) ||
          this.asString(payload.remoteJidAlt) ||
          null,
        senderPn:
          this.asString(key.senderPn) ||
          this.asString(data.senderPn) ||
          this.asString(payload.senderPn) ||
          null,
        participantPn:
          this.asString(key.participantPn) ||
          this.asString(data.participantPn) ||
          this.asString(payload.participantPn) ||
          null,
        participantAlt:
          this.asString(key.participantAlt) ||
          this.asString(data.participantAlt) ||
          this.asString(payload.participantAlt) ||
          null,
      }),
    );
  }

  private async findEvolutionMessagePayload(
    instanceName: string,
    messageId: string,
  ): Promise<JsonRecord | null> {
    if (!instanceName.trim() || !messageId.trim() || typeof this.configService?.get !== 'function') {
      return null;
    }

    try {
      const response = await this.getEvolutionClient().post(`/chat/findMessages/${instanceName}`, {
        where: {
          key: {
            id: messageId,
          },
        },
        page: 1,
        offset: 1,
      });

      const [message] = this.extractEvolutionRecords(response.data, ['messages']);
      return message ? this.asRecord(message) : null;
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'whatsapp_webhook_payload_enrichment_failed',
          instanceName,
          messageId,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
      return null;
    }
  }

  private async resolveIncomingRecipientFromEvolutionMessage(
    instanceName: string,
    messageId: string,
    instancePhone?: string | null,
  ): Promise<string | null> {
    const payload = await this.findEvolutionMessagePayload(instanceName, messageId);
    if (!payload) {
      return null;
    }

    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);
    const resolvedRecipient = this.resolveIncomingRecipient(payload, data, key, instancePhone).trim();

    if (resolvedRecipient) {
      return resolvedRecipient;
    }

    return null;
  }

  private extractEvolutionRecords(payload: unknown, preferredKeys: string[] = []): unknown[] {
    if (Array.isArray(payload)) {
      return payload;
    }

    const record = this.asRecord(payload);
    const candidates = [
      ...preferredKeys.map((key) => record[key]),
      record.data,
      record.response,
      record.result,
      record.records,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }

      const nested = this.asRecord(candidate);
      for (const key of preferredKeys) {
        const value = nested[key];
        if (Array.isArray(value)) {
          return value;
        }

        const nestedValue = this.asRecord(value);
        if (Array.isArray(nestedValue.records)) {
          return nestedValue.records;
        }
      }

      if (Array.isArray(nested.data)) {
        return nested.data;
      }

      if (Array.isArray(this.asRecord(nested.data).records)) {
        return this.asRecord(nested.data).records as unknown[];
      }

      if (Array.isArray(nested.response)) {
        return nested.response;
      }

      if (Array.isArray(this.asRecord(nested.response).records)) {
        return this.asRecord(nested.response).records as unknown[];
      }

      if (Array.isArray(nested.records)) {
        return nested.records as unknown[];
      }
    }

    return [];
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

  private hasSupportedInboundMessage(message: JsonRecord, messageType?: string): boolean {
    return Boolean(this.detectMessageType(message, messageType));
  }

  private detectMessageType(
    message: JsonRecord,
    messageType?: string,
  ): 'text' | 'image' | 'audio' | null {
    if (messageType === 'audioMessage' || this.hasNestedObject(message, 'audioMessage')) {
      return 'audio';
    }

    if (messageType === 'imageMessage' || this.hasNestedObject(message, 'imageMessage')) {
      return 'image';
    }

    if (
      messageType === 'conversation' ||
      messageType === 'extendedTextMessage' ||
      typeof message.conversation === 'string' ||
      this.hasNestedObject(message, 'extendedTextMessage')
    ) {
      return 'text';
    }

    return null;
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
    diagnostic?: DeliveryDiagnosticContext,
  ): Promise<void> {
    const instanceName = this.getRequiredInstanceName(resolved.whatsapp);
    const finalJid = this.getRequiredOutboundAddress(this.asString(body.number) || '');
    const apiBaseUrl = this.getRequiredWhatsAppConfig(resolved.whatsapp.apiBaseUrl, 'EVOLUTION_URL');
    const apiKey = this.getRequiredWhatsAppConfig(resolved.whatsapp.apiKey, 'AUTHENTICATION_API_KEY');

    body.number = finalJid;
    console.log('JID FINAL:', finalJid);
    console.log('📤 Enviando a:', finalJid);
    console.log('📦 Instancia:', instanceName);

    return this.createEvolutionClient(resolved.whatsapp).post(path, body).then(
      () => undefined,
      (error: unknown) => {
        this.logDeliveryFailure('evolution_send', error, diagnostic, {
          action,
          instanceName,
          path,
          recipientAddress: finalJid,
        });
        this.logger.error(
          JSON.stringify({
            event: 'evolution_request_failed',
            traceId: diagnostic?.traceId ?? null,
            action,
            instanceName,
            path,
            number: finalJid,
            mediatype: this.asString(body.mediatype) || null,
            hasApiBaseUrl: Boolean(apiBaseUrl),
            hasApiKey: Boolean(apiKey),
          }),
        );
        this.handleEvolutionError(error, `Evolution API ${action} failed`);
      },
    );
  }

  private createEvolutionClient(whatsapp: WhatsAppClientConfiguration): AxiosInstance {
    const apiBaseUrl = this.getRequiredWhatsAppConfig(whatsapp.apiBaseUrl, 'EVOLUTION_URL');
    const apiKey = this.getRequiredWhatsAppConfig(whatsapp.apiKey, 'AUTHENTICATION_API_KEY');

    return axios.create({
      baseURL: apiBaseUrl.replace(/\/+$/, ''),
      timeout: 20000,
      headers: {
        apikey: apiKey,
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
    const source = events?.length ? events : WhatsAppService.DEFAULT_WEBHOOK_EVENTS;

    return [
      ...new Set(
        source
          .map((event) => event.trim())
          .filter((event) => event.length > 0)
          .map((event) => {
      const normalized = event.trim();
      if (normalized.toLowerCase() === 'messages.upsert') {
        return 'MESSAGES_UPSERT';
      }

      if (normalized.toLowerCase() === 'messages.set') {
        return 'MESSAGES_SET';
      }

      if (normalized.toLowerCase() === 'messages.update') {
        return 'MESSAGES_UPDATE';
      }

      if (normalized.toLowerCase() === 'messages.delete') {
        return 'MESSAGES_DELETE';
      }

      if (normalized.toLowerCase() === 'messages.edited') {
        return 'MESSAGES_EDITED';
      }

      if (normalized.toLowerCase() === 'send.message') {
        return 'SEND_MESSAGE';
      }

      if (normalized.toLowerCase() === 'send.message.update') {
        return 'SEND_MESSAGE';
      }

      if (normalized.toLowerCase() === 'contacts.set') {
        return 'CONTACTS_SET';
      }

      if (normalized.toLowerCase() === 'contacts.upsert') {
        return 'CONTACTS_UPSERT';
      }

      if (normalized.toLowerCase() === 'contacts.update') {
        return 'CONTACTS_UPDATE';
      }

      if (normalized.toLowerCase() === 'chats.set') {
        return 'CHATS_SET';
      }

      if (normalized.toLowerCase() === 'chats.upsert') {
        return 'CHATS_UPSERT';
      }

      if (normalized.toLowerCase() === 'chats.update') {
        return 'CHATS_UPDATE';
      }

      if (normalized.toLowerCase() === 'chats.delete') {
        return 'CHATS_DELETE';
      }

      if (normalized.toLowerCase() === 'presence.update') {
        return 'PRESENCE_UPDATE';
      }

      if (normalized.toLowerCase() === 'connection.update') {
        return 'CONNECTION_UPDATE';
      }

      if (normalized.toLowerCase() === 'groups.upsert') {
        return 'GROUPS_UPSERT';
      }

      if (normalized.toLowerCase() === 'groups.update') {
        return 'GROUP_UPDATE';
      }

      if (normalized.toLowerCase() === 'group-participants.update') {
        return 'GROUP_PARTICIPANTS_UPDATE';
      }

      if (normalized.toLowerCase() === 'call') {
        return 'CALL';
      }

      return normalized;
          }),
      ),
    ];
  }

  private extractPhone(data: JsonRecord): string | null {
    const instance = this.asRecord(data.instance);
    const instanceData = this.asRecord(data.instanceData);
    const me = this.asRecord(data.me);
    const instanceMe = this.asRecord(instance.me);
    const instanceDataMe = this.asRecord(instanceData.me);

    return (
      this.asString(data.number) ||
      this.asString(data.phone) ||
      this.asString(data.wuid) ||
      this.asString(data.ownerJid) ||
      this.asString(data.wid) ||
      this.asString(me.id) ||
      this.asString(me.lid) ||
      this.asString(instance.number) ||
      this.asString(instance.phone) ||
      this.asString(instance.wuid) ||
      this.asString(instance.ownerJid) ||
      this.asString(instance.wid) ||
      this.asString(instanceMe.id) ||
      this.asString(instanceMe.lid) ||
      this.asString(instanceData.number) ||
      this.asString(instanceData.phone) ||
      this.asString(instanceData.wuid) ||
      this.asString(instanceData.ownerJid) ||
      this.asString(instanceData.wid) ||
      this.asString(instanceDataMe.id) ||
      this.asString(instanceDataMe.lid) ||
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

  private extractQrCode(payload: JsonRecord): string | null {
    const qrcode = this.asRecord(payload.qrcode);
    const qr = this.asRecord(payload.qr);
    const value =
      this.asString(payload.code) ||
      this.asString(payload.qrCode) ||
      this.asString(payload.qrcode) ||
      this.asString(qrcode.code) ||
      this.asString(qrcode.value) ||
      this.asString(qr.code) ||
      this.asString(qr.value) ||
      this.asString(qr.text);

    return value?.trim() ? value.trim() : null;
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
    instancePhone?: string | null,
  ): string {
    return this.resolveSenderJid(payload, data, key, instancePhone);
  }

  private resolveSenderJid(
    payload: JsonRecord,
    data?: JsonRecord,
    key?: JsonRecord,
    instancePhone?: string | null,
  ): string {
    const messageData = data ?? this.getWebhookMessageData(payload);
    const messageKey = key ?? this.asRecord(messageData.key);
    const remoteJid =
      this.asString(messageKey.remoteJid) || this.asString(messageData.remoteJid) || '';
    const participant =
      this.asString(messageKey.participant) ||
      this.asString(messageData.participant) ||
      this.asString(payload.participant) ||
      '';
    const normalizedInstancePhone = this.normalizeNumber(instancePhone || '');
    const candidates = [
      participant,
      this.asString(messageKey.participantAlt),
      this.asString(messageData.participantAlt),
      this.asString(payload.participantAlt),
      this.asString(messageKey.participantPn),
      this.asString(messageData.participantPn),
      this.asString(payload.participantPn),
      this.asString(messageKey.senderPn),
      this.asString(messageData.senderPn),
      this.asString(payload.senderPn),
      this.asString(messageKey.sender),
      this.asString(messageData.sender),
      this.asString(payload.sender),
      this.asString(messageKey.remoteJidAlt),
      this.asString(messageData.remoteJidAlt),
      this.asString(payload.remoteJidAlt),
      remoteJid,
    ].filter((value): value is string => Boolean(value?.trim()));

    console.log('📥 remoteJid:', remoteJid || null);
    console.log('📥 participant:', participant || null);

    for (const candidate of candidates) {
      const normalizedCandidate = candidate.trim().toLowerCase();
      if (!normalizedCandidate.includes('@s.whatsapp.net')) {
        continue;
      }

      if (this.normalizeNumber(normalizedCandidate) === normalizedInstancePhone) {
        continue;
      }

      console.log('📤 JID FINAL:', normalizedCandidate);
      return normalizedCandidate;
    }

    if (remoteJid.includes('@lid')) {
      console.log('⚠️ LID detectado, no se puede responder directamente:', remoteJid);
    }

    console.log('📤 JID FINAL:', null);
    return '';
  }

  private async getInstancePhoneNumber(instanceName: string): Promise<string | null> {
    const normalizedName = instanceName.trim();
    if (!normalizedName) {
      return null;
    }

    if (!this.prisma?.whatsAppInstance?.findUnique) {
      return null;
    }

    const instance = await this.prisma.whatsAppInstance.findUnique({
      where: { name: normalizedName },
      select: { phone: true },
    });

    const storedPhone = instance?.phone?.trim() || null;
    if (storedPhone) {
      return storedPhone;
    }

    if (!this.syncInstanceFromEvolution) {
      return null;
    }

    try {
      const syncedInstance = await this.syncInstanceFromEvolution(normalizedName);
      return syncedInstance?.phone?.trim() || null;
    } catch {
      return null;
    }
  }

  private normalizeNumber(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace('@s.whatsapp.net', '')
      .replace('@lid', '')
      .replace(/\D/g, '');
  }

  private getRequiredInstanceName(whatsapp: WhatsAppClientConfiguration): string {
    return this.getRequiredWhatsAppConfig(
      whatsapp.instanceName,
      'EVOLUTION_INSTANCE_NAME',
      'Instance name is required',
    );
  }

  private getRequiredOutboundNumber(number: string): string {
    const cleanNumber = this.normalizeNumber(number);
    if (!cleanNumber) {
      throw new HttpException('Valid number is required', HttpStatus.BAD_REQUEST);
    }

    return cleanNumber;
  }

  private getRequiredOutboundAddress(address: string): string {
    const normalized = address.trim().toLowerCase();
    if (!normalized.includes('@s.whatsapp.net')) {
      throw new HttpException('JID invalido para envio', HttpStatus.BAD_REQUEST);
    }

    return normalized;
  }

  private normalizeJid(jid: string): string | null {
    if (!jid) {
      return null;
    }

    const normalizedRaw = jid.trim().toLowerCase();
    if (!normalizedRaw) {
      return null;
    }

    if (!normalizedRaw.includes('@s.whatsapp.net')) {
      return null;
    }

    return normalizedRaw;
  }

  private normalizeOutboundAddress(raw: string): string {
    const normalizedRaw = raw.trim().toLowerCase();
    if (!normalizedRaw) {
      return '';
    }

    return this.normalizeJid(normalizedRaw) || '';
  }

  private getRequiredWhatsAppConfig(
    value: string | null | undefined,
    envName: string,
    message?: string,
  ): string {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }

    throw new HttpException(message || `${envName} is required`, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  private normalizeInstanceName(name: string): string {
    const normalized = name.trim();
    if (!normalized) {
      throw new BadRequestException('El nombre de la instancia es obligatorio.');
    }

    return normalized;
  }

  private normalizeOptionalInstanceField(value?: string | null): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private createWebhookTraceContext(payload: JsonRecord): WebhookTraceContext {
    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);

    return {
      traceId: randomUUID(),
      event: this.asString(payload.event) || null,
      instanceName: this.asString(payload.instance) || null,
      messageId: this.asString(key.id) || this.asString(data.messageId) || null,
      remoteJid: this.asString(key.remoteJid) || this.asString(data.remoteJid) || null,
      pushName: this.asString(data.pushName) || this.asString(payload.pushName) || null,
      topLevelSender: this.asString(payload.sender) || this.asString(payload.from) || null,
    };
  }

  private mergeWebhookTraceContext(
    trace: WebhookTraceContext,
    patch: Partial<WebhookTraceContext>,
  ): WebhookTraceContext {
    return {
      ...trace,
      ...patch,
    };
  }

  private mergeDeliveryDiagnosticContext(
    diagnostic?: DeliveryDiagnosticContext,
    patch?: Partial<DeliveryDiagnosticContext>,
  ): DeliveryDiagnosticContext {
    return {
      ...(diagnostic ?? {}),
      ...(patch ?? {}),
    };
  }

  private createDeliveryDiagnostic(
    trace: WebhookTraceContext,
    incoming: NormalizedIncomingWhatsAppMessage,
    recipientRouting: { address: string | null; number: string | null },
  ): DeliveryDiagnosticContext {
    return {
      traceId: trace.traceId,
      instanceName: trace.instanceName,
      messageId: incoming.messageId,
      contactId: incoming.number,
      messageType: incoming.type,
      remoteJid: trace.remoteJid,
      recipientAddress: recipientRouting.address,
      recipientNumber: recipientRouting.number,
    };
  }

  private logWebhookStage(
    stage: string,
    trace: WebhookTraceContext,
    details: JsonRecord = {},
  ): void {
    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_pipeline_stage',
        traceId: trace.traceId,
        stage,
        eventName: trace.event,
        instanceName: trace.instanceName,
        messageId: trace.messageId,
        remoteJid: trace.remoteJid,
        pushName: trace.pushName,
        topLevelSender: trace.topLevelSender,
        ...details,
      }),
    );
  }

  private logWebhookDiagnostic(
    reason: string,
    trace: WebhookTraceContext,
    details: JsonRecord = {},
  ): void {
    this.logger.warn(
      JSON.stringify({
        event: 'whatsapp_pipeline_diagnostic',
        traceId: trace.traceId,
        reason,
        eventName: trace.event,
        instanceName: trace.instanceName,
        messageId: trace.messageId,
        remoteJid: trace.remoteJid,
        pushName: trace.pushName,
        topLevelSender: trace.topLevelSender,
        ...details,
      }),
    );
  }

  private logWebhookFailure(
    stage: string,
    error: unknown,
    trace: WebhookTraceContext,
    details: JsonRecord = {},
  ): void {
    const errorPayload = this.describeError(error);

    this.logger.error(
      JSON.stringify({
        event: 'whatsapp_pipeline_failure',
        traceId: trace.traceId,
        stage,
        eventName: trace.event,
        instanceName: trace.instanceName,
        messageId: trace.messageId,
        remoteJid: trace.remoteJid,
        pushName: trace.pushName,
        topLevelSender: trace.topLevelSender,
        ...errorPayload,
        ...details,
      }),
      error instanceof Error ? error.stack : undefined,
    );
  }

  private logDeliveryStage(
    stage: string,
    diagnostic?: DeliveryDiagnosticContext,
    details: JsonRecord = {},
  ): void {
    if (!diagnostic?.traceId) {
      return;
    }

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp_delivery_stage',
        traceId: diagnostic.traceId,
        stage,
        instanceName: diagnostic.instanceName ?? null,
        messageId: diagnostic.messageId ?? null,
        contactId: diagnostic.contactId ?? null,
        messageType: diagnostic.messageType ?? null,
        remoteJid: diagnostic.remoteJid ?? null,
        recipientAddress: diagnostic.recipientAddress ?? null,
        recipientNumber: diagnostic.recipientNumber ?? null,
        ...details,
      }),
    );
  }

  private logDeliveryDiagnostic(
    reason: string,
    diagnostic?: DeliveryDiagnosticContext,
    details: JsonRecord = {},
  ): void {
    this.logger.warn(
      JSON.stringify({
        event: 'whatsapp_delivery_diagnostic',
        traceId: diagnostic?.traceId ?? null,
        reason,
        instanceName: diagnostic?.instanceName ?? null,
        messageId: diagnostic?.messageId ?? null,
        contactId: diagnostic?.contactId ?? null,
        messageType: diagnostic?.messageType ?? null,
        remoteJid: diagnostic?.remoteJid ?? null,
        recipientAddress: diagnostic?.recipientAddress ?? null,
        recipientNumber: diagnostic?.recipientNumber ?? null,
        ...details,
      }),
    );
  }

  private logDeliveryFailure(
    stage: string,
    error: unknown,
    diagnostic?: DeliveryDiagnosticContext,
    details: JsonRecord = {},
  ): void {
    const errorPayload = this.describeError(error);

    this.logger.error(
      JSON.stringify({
        event: 'whatsapp_delivery_failure',
        traceId: diagnostic?.traceId ?? null,
        stage,
        instanceName: diagnostic?.instanceName ?? null,
        messageId: diagnostic?.messageId ?? null,
        contactId: diagnostic?.contactId ?? null,
        messageType: diagnostic?.messageType ?? null,
        remoteJid: diagnostic?.remoteJid ?? null,
        recipientAddress: diagnostic?.recipientAddress ?? null,
        recipientNumber: diagnostic?.recipientNumber ?? null,
        ...errorPayload,
        ...details,
      }),
      error instanceof Error ? error.stack : undefined,
    );
  }

  private buildRoutingDiagnosticReasons(
    payload: JsonRecord,
    instancePhone: string | null | undefined,
    recipientRouting: { address: string | null; number: string | null },
    incoming?: NormalizedIncomingWhatsAppMessage | null,
  ): string[] {
    const data = this.getWebhookMessageData(payload);
    const key = this.asRecord(data.key);
    const remoteJid = this.asString(key.remoteJid) || this.asString(data.remoteJid) || '';
    const reasons = new Set<string>();

    if (!instancePhone?.trim()) {
      reasons.add('instance_phone_missing');
    }

    if (remoteJid.includes('@lid')) {
      reasons.add('remote_jid_is_lid');
    }

    if (!this.hasWebhookSenderMetadata(payload)) {
      reasons.add('missing_sender_metadata');
    }

    if (!(this.asString(payload.sender) || this.asString(payload.from))) {
      reasons.add('top_level_sender_missing');
    }

    if (!recipientRouting.address) {
      reasons.add('recipient_address_unresolved');
    }

    if (!recipientRouting.number) {
      reasons.add('recipient_number_unresolved');
    }

    if (incoming && !incoming.outboundAddress?.includes('@s.whatsapp.net')) {
      reasons.add('outbound_address_not_real_jid');
    }

    return [...reasons];
  }

  private buildDeliveryDiagnosticReasons(
    diagnostic: DeliveryDiagnosticContext | undefined,
    outboundAddress: string,
  ): string[] {
    const reasons = new Set<string>();

    if (!diagnostic?.recipientAddress) {
      reasons.add('recipient_address_unresolved');
    }

    if (!diagnostic?.recipientNumber) {
      reasons.add('recipient_number_unresolved');
    }

    if (!outboundAddress.trim()) {
      reasons.add('outbound_address_missing');
    }

    if (outboundAddress.trim() && !outboundAddress.includes('@s.whatsapp.net')) {
      reasons.add('outbound_address_not_real_jid');
    }

    return [...reasons];
  }

  private describeError(error: unknown): JsonRecord {
    if (axios.isAxiosError(error)) {
      return {
        errorType: 'axios',
        errorMessage: error.message,
        errorCode: error.code ?? null,
        status: error.response?.status ?? null,
        responseData: error.response?.data ?? null,
      };
    }

    if (error instanceof HttpException) {
      return {
        errorType: 'http_exception',
        errorMessage: error.message,
        status: error.getStatus(),
        responseData: error.getResponse(),
      };
    }

    if (error instanceof Error) {
      return {
        errorType: 'error',
        errorMessage: error.message,
        errorCode:
          'code' in error ? this.stringifyScalar((error as Error & { code?: unknown }).code) : null,
      };
    }

    return {
      errorType: typeof error,
      errorMessage: this.stringifyScalar(error),
    };
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

  private async ensureWebhookInstanceExists(instanceName: string): Promise<void> {
    const existing = await this.prisma.whatsAppInstance.findUnique({
      where: { name: instanceName },
    });

    if (existing) {
      return;
    }

    const synced = await this.syncInstanceFromEvolution(instanceName);
    if (synced) {
      return;
    }

    throw new HttpException('La instancia no existe', HttpStatus.NOT_FOUND);
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

  private async clearConfiguredInstanceIfMatches(instanceName: string): Promise<void> {
    const normalizedInstanceName = instanceName.trim();
    if (!normalizedInstanceName || !this.prisma?.whatsAppSettings?.updateMany) {
      return;
    }

    await this.prisma.whatsAppSettings.updateMany({
      where: { instanceName: normalizedInstanceName },
      data: { instanceName: '' },
    });
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
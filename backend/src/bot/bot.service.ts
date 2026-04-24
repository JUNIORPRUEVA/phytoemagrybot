import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { AssistantResponseStyle } from '../ai/ai.types';
import { BotConfigService } from '../bot-config/bot-config.service';
import { ClientConfigService } from '../config/config.service';
import { MediaService } from '../media/media.service';
import { MemoryService } from '../memory/memory.service';
import { RedisService } from '../redis/redis.service';
import {
  BotIntent,
  BotReplyResult,
  BotTestReport,
  BotTestStepResult,
} from './bot.types';

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly botConfigService: BotConfigService,
    private readonly clientConfigService: ClientConfigService,
    private readonly mediaService: MediaService,
    private readonly memoryService: MemoryService,
    private readonly redisService: RedisService,
  ) {}

  async processIncomingMessage(contactId: string, message: string): Promise<BotReplyResult> {
    const normalizedContactId = contactId.trim();
    const normalizedMessage = message.trim();

    if (!normalizedContactId) {
      throw new BadRequestException('contactId is required');
    }

    if (!/^\+?[0-9A-Za-z._:-]{3,120}$/.test(normalizedContactId)) {
      throw new BadRequestException('contactId is invalid');
    }

    if (!normalizedMessage) {
      throw new BadRequestException('message is required');
    }

    const config = await this.clientConfigService.getConfig();
    const botConfig = await this.botConfigService.getConfig();
    const memoryWindow = config.aiSettings?.memoryWindow ?? 6;
    const cacheTtlSeconds = config.botSettings?.responseCacheTtlSeconds ?? 60;

    this.logger.log(
      JSON.stringify({
        event: 'bot_message_received',
        contactId: normalizedContactId,
        message: normalizedMessage,
      }),
    );
    console.log('NUMERO:', normalizedContactId);
    console.log('MENSAJE:', normalizedMessage);

    await this.memoryService.saveMessage({
      contactId: normalizedContactId,
      role: 'user',
      content: normalizedMessage,
    });

    const memoryContext = await this.memoryService.getConversationContext(
      normalizedContactId,
      memoryWindow,
    );
    const history = this.excludeCurrentUserMessage(
      memoryContext.messages,
      normalizedMessage,
    );
    const intent = this.detectIntent(normalizedMessage);
    const hotLead = this.shouldTreatAsHotLead(
      normalizedMessage,
      intent,
      memoryContext.clientMemory.lastIntent,
    );
    const mediaFiles = await this.selectMedia(normalizedMessage, intent);
    const preferredReplyType = this.resolvePreferredReplyType(normalizedMessage);
    const responseStyle = this.resolveResponseStyle(normalizedMessage, intent);
    const usedMemory = this.hasUsefulMemory(memoryContext, history.length);
    const cacheKey = this.getReplyCacheKey(normalizedContactId, normalizedMessage);
    const cachedReply = await this.redisService.get<BotReplyResult>(cacheKey);

    if (cachedReply) {
      const result: BotReplyResult = {
        ...cachedReply,
        cached: true,
        source: 'cache',
      };

      await this.memoryService.saveMessage({
        contactId: normalizedContactId,
        role: 'assistant',
        content: result.reply,
      });

      console.log('RESPUESTA:', result.reply);
      this.logReply(normalizedContactId, result);
      return result;
    }

    const fastLaneReply = this.buildFastLaneReply({
      message: normalizedMessage,
      intent,
      hotLead,
      mediaFiles,
      preferredReplyType,
      responseStyle,
      usedMemory,
    });

    if (fastLaneReply) {
      await this.memoryService.saveMessage({
        contactId: normalizedContactId,
        role: 'assistant',
        content: fastLaneReply.reply,
      });

      await this.redisService.set(cacheKey, fastLaneReply, cacheTtlSeconds);
      console.log('RESPUESTA:', fastLaneReply.reply);
      this.logReply(normalizedContactId, fastLaneReply);
      return fastLaneReply;
    }

    const reply = await this.aiService.generateReply({
      config,
      fullPrompt: this.botConfigService.getFullPrompt(botConfig),
      contactId: normalizedContactId,
      message: normalizedMessage,
      history,
      context: this.buildConversationContext(memoryContext),
      responseStyle,
    });

    await this.memoryService.saveMessage({
      contactId: normalizedContactId,
      role: 'assistant',
      content: reply.content,
    });

    const result: BotReplyResult = {
      reply: reply.content,
      replyType: preferredReplyType === 'audio' ? 'audio' : reply.type,
      mediaFiles,
      intent,
      hotLead,
      cached: false,
      usedGallery: mediaFiles.length > 0,
      usedMemory,
      source: 'ai',
    };

    await this.redisService.set(cacheKey, result, cacheTtlSeconds);
    console.log('RESPUESTA:', result.reply);
    this.logReply(normalizedContactId, result);
    return result;
  }

  async runBotTests(): Promise<BotTestReport> {
    const startedAt = Date.now();
    const baseContactId = `__bot_test__${startedAt}`;
    const scenarios: Array<{ scenario: string; contactId: string; messages: string[]; expectGallery: boolean; expectHot: boolean; expectClose: boolean }> = [
      {
        scenario: 'precio',
        contactId: `${baseContactId}-thread`,
        messages: ['precio'],
        expectGallery: true,
        expectHot: false,
        expectClose: false,
      },
      {
        scenario: 'ok',
        contactId: `${baseContactId}-thread`,
        messages: ['ok'],
        expectGallery: false,
        expectHot: false,
        expectClose: true,
      },
      {
        scenario: 'quiero catalogo',
        contactId: `${baseContactId}-thread`,
        messages: ['quiero catálogo'],
        expectGallery: true,
        expectHot: false,
        expectClose: false,
      },
      {
        scenario: 'multiples mensajes',
        contactId: `${baseContactId}-multi`,
        messages: ['hola', 'quiero info', 'precio'],
        expectGallery: true,
        expectHot: false,
        expectClose: false,
      },
      {
        scenario: 'mensaje repetido',
        contactId: `${baseContactId}-repeat`,
        messages: ['precio', 'precio'],
        expectGallery: true,
        expectHot: false,
        expectClose: false,
      },
      {
        scenario: 'hot lead',
        contactId: `${baseContactId}-hot`,
        messages: ['lo quiero'],
        expectGallery: false,
        expectHot: true,
        expectClose: true,
      },
    ];

    const results: BotTestStepResult[] = [];

    for (const scenario of scenarios) {
      try {
        let result: BotReplyResult | undefined;

        for (const message of scenario.messages) {
          result = await this.processIncomingMessage(scenario.contactId, message);
        }

        if (!result) {
          throw new Error('No se genero respuesta');
        }

        const shortReply = this.isShortReply(result.reply);
        const salesClose = this.looksLikeSalesClose(result.reply);
        const stepResult: BotTestStepResult = {
          scenario: scenario.scenario,
          contactId: scenario.contactId,
          messages: scenario.messages,
          passed:
            shortReply &&
            (!scenario.expectGallery || result.usedGallery) &&
            (!scenario.expectHot || result.hotLead) &&
            (!scenario.expectClose || salesClose),
          checks: {
            shortReply,
            usedGallery: !scenario.expectGallery || result.usedGallery,
            detectedHotLead: !scenario.expectHot || result.hotLead,
            salesClose: !scenario.expectClose || salesClose,
          },
          result,
        };

        results.push(stepResult);
      } catch (error) {
        results.push({
          scenario: scenario.scenario,
          contactId: scenario.contactId,
          messages: scenario.messages,
          passed: false,
          checks: {
            shortReply: false,
            usedGallery: !scenario.expectGallery,
            detectedHotLead: !scenario.expectHot,
            salesClose: !scenario.expectClose,
          },
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      ok: results.every((item) => item.passed),
      durationMs: Date.now() - startedAt,
      results,
    };
  }

  async getMediaByKeyword(text: string) {
    return this.mediaService.getMediaByKeyword(text);
  }

  detectIntent(message: string): BotIntent {
    const normalized = message.trim().toLowerCase();

    if (!normalized) {
      return 'otro';
    }

    if (['catalogo', 'catálogo', 'catalog'].some((keyword) => normalized.includes(keyword))) {
      return 'catalogo';
    }

    if (this.detectHotLead(normalized)) {
      return 'hot';
    }

    if (this.requiresDetailedResponse(normalized)) {
      return 'duda';
    }

    if (['funciona', 'calidad', 'sirve', 'garantia', 'garantía', 'resultado', 'resultados'].some((keyword) => normalized.includes(keyword))) {
      return 'duda';
    }

    if (['ok', 'perfecto', 'dale', 'esta bien', 'está bien'].some((keyword) => normalized.includes(keyword))) {
      return 'cierre';
    }

    if (['comprar', 'pedido', 'ordenar'].some((keyword) => normalized.includes(keyword))) {
      return 'compra';
    }

    if (['precio', 'info', 'informacion', 'información', 'detalle', 'detalles', 'quiero', 'necesito', 'me interesa'].some((keyword) => normalized.includes(keyword))) {
      return 'interes';
    }

    return 'otro';
  }

  detectHotLead(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return ['lo quiero', 'dame uno', 'como compro', 'cómo compro', 'lo compro', 'quiero comprar', 'te voy a comprar']
      .some((keyword) => normalized.includes(keyword));
  }

  private buildConversationContext(
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
  ): string {
    const sections: string[] = [];

    if (memoryContext.summary.summary?.trim()) {
      sections.push(`Resumen de la conversacion:\n${memoryContext.summary.summary.trim()}`);
    }

    const memoryLines = [
      memoryContext.clientMemory.name
        ? `Nombre del cliente: ${memoryContext.clientMemory.name}`
        : null,
      memoryContext.clientMemory.interest
        ? `Interes detectado: ${memoryContext.clientMemory.interest}`
        : null,
      memoryContext.clientMemory.lastIntent
        ? `Ultima intencion detectada: ${memoryContext.clientMemory.lastIntent}`
        : null,
      memoryContext.clientMemory.notes
        ? `Notas importantes: ${memoryContext.clientMemory.notes}`
        : null,
    ].filter((value): value is string => Boolean(value));

    if (memoryLines.length > 0) {
      sections.push(`Memoria persistente:\n${memoryLines.join('\n')}`);
    }

    sections.push(
      'Usa esta memoria para continuar la conversacion de forma natural, recordar datos del cliente y evitar repetir preguntas ya resueltas.',
    );

    return sections.join('\n\n');
  }

  private async selectMedia(message: string, intent: BotIntent) {
    const take = intent === 'catalogo' || this.isVisualRequest(message) ? 5 : 3;
    return this.mediaService.getMediaByKeyword(message, take);
  }

  private buildFastLaneReply(params: {
    message: string;
    intent: BotIntent;
    hotLead: boolean;
    mediaFiles: Awaited<ReturnType<BotService['getMediaByKeyword']>>;
    preferredReplyType: BotReplyResult['replyType'];
    responseStyle: AssistantResponseStyle;
    usedMemory: boolean;
  }): BotReplyResult | null {
    if (
      this.requiresDetailedResponse(params.message) ||
      this.requiresSpecificDirectAnswer(params.message, params.intent)
    ) {
      return null;
    }

    if (params.hotLead || params.intent === 'hot') {
      return this.createResult(
        'Perfecto 👍 te lo dejo listo, ¿te lo envío hoy?',
        'hot',
        params.intent,
        true,
        params.mediaFiles,
        params.preferredReplyType,
        params.usedMemory,
      );
    }

    if (params.intent === 'duda') {
      return this.createResult(
        'Sí, funciona excelente 👌 es de los que más vendemos.',
        'duda',
        params.intent,
        false,
        params.mediaFiles,
        params.preferredReplyType,
        params.usedMemory,
      );
    }

    if (params.intent === 'cierre') {
      return this.createResult(
        'Perfecto 👍 te lo dejo listo, ¿te lo envío hoy?',
        'cierre',
        params.intent,
        false,
        params.mediaFiles,
        params.preferredReplyType,
        params.usedMemory,
      );
    }

    if (params.mediaFiles.length > 0) {
      const galleryReply = params.intent === 'catalogo'
        ? 'Claro 👍 mira el catálogo aquí.'
        : 'Claro 👌 mira esta referencia.';

      return this.createResult(
        galleryReply,
        'galeria',
        params.intent,
        false,
        params.mediaFiles,
        params.preferredReplyType,
        params.usedMemory,
      );
    }

    return null;
  }

  private createResult(
    reply: string,
    source: BotReplyResult['source'],
    intent: BotIntent,
    hotLead: boolean,
    mediaFiles: Awaited<ReturnType<BotService['getMediaByKeyword']>>,
    replyType: BotReplyResult['replyType'],
    usedMemory: boolean,
  ): BotReplyResult {
    return {
      reply,
      replyType,
      mediaFiles,
      intent,
      hotLead,
      cached: false,
      usedGallery: mediaFiles.length > 0,
      usedMemory,
      source,
    };
  }

  private resolvePreferredReplyType(message: string): BotReplyResult['replyType'] {
    return this.prefersVoiceReply(message) ? 'audio' : 'text';
  }

  private resolveResponseStyle(
    message: string,
    intent: BotIntent,
  ): AssistantResponseStyle {
    if (this.requiresDetailedResponse(message)) {
      return 'detailed';
    }

    if (this.requiresSpecificDirectAnswer(message, intent)) {
      return 'brief';
    }

    return 'balanced';
  }

  private shouldTreatAsHotLead(
    message: string,
    intent: BotIntent,
    lastIntent: string | null,
  ): boolean {
    if (this.detectHotLead(message)) {
      return true;
    }

    if (lastIntent !== 'HOT') {
      return false;
    }

    if (this.requiresDetailedResponse(message)) {
      return false;
    }

    return intent === 'compra' || intent === 'cierre' || intent === 'interes' || intent === 'hot';
  }

  private requiresDetailedResponse(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'explicame',
      'explícame',
      'hablame',
      'háblame',
      'cuentame',
      'cuéntame',
      'dime mas',
      'dime más',
      'quiero saber',
      'me gustaria saber',
      'me gustaría saber',
      'como funciona',
      'cómo funciona',
      'que contiene',
      'qué contiene',
      'beneficios',
      'hablame un poco',
      'háblame un poco',
      'un poco de',
      'de la pastilla',
      'de las pastillas',
      'informacion',
      'información',
      'detalle',
      'detalles',
    ].some((keyword) => normalized.includes(keyword));
  }

  private requiresSpecificDirectAnswer(message: string, intent: BotIntent): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'precio',
      'cuanto cuesta',
      'cuánto cuesta',
      'cuanto vale',
      'cuánto vale',
      'disponible',
      'hay disponible',
      'envio',
      'envío',
      'delivery',
    ].some((keyword) => normalized.includes(keyword));
  }

  private prefersVoiceReply(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'nota de voz',
      'audio',
      'voz',
      'hablame',
      'háblame',
      'explicame por voz',
      'explícame por voz',
      'mandame un audio',
      'mándame un audio',
      'responde por audio',
      'respondeme por audio',
      'respóndeme por audio',
    ].some((keyword) => normalized.includes(keyword));
  }

  private isVisualRequest(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'foto',
      'fotos',
      'imagen',
      'imagenes',
      'imágenes',
      'catalogo',
      'catálogo',
      'muestrame',
      'muéstrame',
      'ensename',
      'enséñame',
      'ver',
      'referencia',
      'referencias',
      'antes y despues',
      'antes y después',
      'resultado',
      'resultados',
    ].some((keyword) => normalized.includes(keyword));
  }

  private hasUsefulMemory(
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
    historyLength: number,
  ): boolean {
    return Boolean(
      historyLength > 0 ||
        memoryContext.summary.summary?.trim() ||
        memoryContext.clientMemory.name ||
        memoryContext.clientMemory.interest ||
        memoryContext.clientMemory.lastIntent ||
        memoryContext.clientMemory.notes,
    );
  }

  private getReplyCacheKey(contactId: string, message: string): string {
    return `cache:${contactId}:${message.trim().toLowerCase()}`;
  }

  private isShortReply(reply: string): boolean {
    const lineCount = reply.split('\n').filter((line) => line.trim().length > 0).length;
    const wordCount = reply.split(/\s+/).filter((word) => word.length > 0).length;
    return lineCount <= 2 && wordCount <= 15;
  }

  private looksLikeSalesClose(reply: string): boolean {
    const normalized = reply.toLowerCase();
    return ['te lo envío', 'te lo envio', 'lo dejo listo', 'hoy'].some((keyword) => normalized.includes(keyword));
  }

  private logReply(contactId: string, result: BotReplyResult): void {
    this.logger.log(
      JSON.stringify({
        event: 'bot_reply_generated',
        contactId,
        intent: result.intent,
        hotLead: result.hotLead,
        usedMemory: result.usedMemory,
        usedGallery: result.usedGallery,
        cached: result.cached,
        source: result.source,
        replyType: result.replyType,
      }),
    );
  }

  private excludeCurrentUserMessage(
    history: Awaited<ReturnType<MemoryService['getRecentMessages']>>,
    currentMessage: string,
  ) {
    if (history.length === 0) {
      return history;
    }

    const lastMessage = history[history.length - 1];
    if (
      lastMessage.role === 'user' &&
      lastMessage.content.trim() === currentMessage.trim()
    ) {
      return history.slice(0, -1);
    }

    return history;
  }
}
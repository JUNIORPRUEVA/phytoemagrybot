import { createHash } from 'node:crypto';
import { MediaFile, Prisma } from '@prisma/client';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import {
  AssistantLeadStage,
  AssistantReplyObjective,
  AssistantResponseCandidate,
  AssistantResponseStyle,
} from '../ai/ai.types';
import { BotConfigService } from '../bot-config/bot-config.service';
import { CompanyContextService } from '../company-context/company-context.service';
import { ClientConfigService } from '../config/config.service';
import { MediaService } from '../media/media.service';
import { StoredMessage } from '../memory/memory.types';
import { MemoryService } from '../memory/memory.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  BotDecisionAction,
  BotDecisionIntent,
  BotDecisionState,
  ContactStage,
} from './bot-decision.types';
import {
  BotIntent,
  BotReplyResult,
  BotTestReport,
  BotTestStepResult,
} from './bot.types';
import {
  buildConversationMemoryContext,
  ConversationMemoryState,
  getConversationMemoryKey,
  normalizeConversationMemory,
  recordConversationDelivery,
  ResponseValidationReason,
  validateResponseCandidate,
} from './conversation-memory';
import {
  applyCompanyRules,
  buildCompanyRuleMediaUnavailableResponse,
  buildCompanyRuleInstruction,
  CompanyRuleCheck,
  validateCompanyRuleResponse,
} from './company-rule-engine';

type MediaIntent = 'IMAGEN' | 'VIDEO' | 'MEDIA' | null;

interface StructuredProduct {
  id: string;
  titulo: string;
  descripcionCorta: string;
  descripcionCompleta: string;
  precio: string | number | null;
  precioMinimo: string | number | null;
  imagenes: string[];
  videos: string[];
  activo: boolean;
}

interface SentMediaState {
  sentMediaUrls: string[];
}

interface ThinkingAnalysis {
  intent: string;
  userState: 'frio' | 'curioso' | 'interesado' | 'listo';
  alreadyExplained: boolean;
  repetitionRisk: boolean;
  nextBestAction: 'explicar' | 'resumir' | 'preguntar' | 'cerrar' | 'avanzar';
  responseStrategy: string;
}

interface IntentCacheEntry {
  message: string;
  intent: BotDecisionIntent;
  source: BotDecisionState['classificationSource'];
  updatedAt: number;
}

interface RedisStateSnapshot {
  stage: ContactStage;
  currentIntent: BotDecisionIntent;
  purchaseIntentScore: number;
  updatedAt: number;
}

interface AnalysisCacheEntry {
  intent: string;
  userState: ThinkingAnalysis['userState'];
  alreadyExplained: boolean;
  repetitionRisk: boolean;
  nextBestAction: ThinkingAnalysis['nextBestAction'];
  responseStrategy: string;
  updatedAt: number;
}

interface NextBestActionCacheEntry {
  action: ThinkingAnalysis['nextBestAction'];
  reason: string;
  updatedAt: number;
}

interface ResponseCacheEntry {
  reply: string;
  replyType: BotReplyResult['replyType'];
  intent: BotIntent;
  decisionIntent: BotDecisionIntent;
  stage: ContactStage;
  action: BotDecisionAction;
  purchaseIntentScore: number;
  hotLead: boolean;
  source: BotReplyResult['source'];
  updatedAt: number;
}

interface MediaCacheEntry {
  images: string[];
  videos: string[];
  updatedAt: number;
}

@Injectable()
export class BotService {
  private static readonly KNOWLEDGE_CONTEXT_CACHE_KEY = 'bot:knowledge-context:v2';
  private static readonly COMPANY_RULES_CACHE_KEY = 'company_rules';
  private static readonly SENT_MEDIA_CACHE_KEY_PREFIX = 'bot:sent-media:';
  private static readonly CONVERSATION_MEMORY_TTL_SECONDS = 60 * 60 * 24;
  private static readonly CONVERSATION_END_TTL_SECONDS = 60 * 60 * 2;
  private static readonly INTENT_CACHE_TTL_SECONDS = 60 * 60;
  private static readonly STATE_CACHE_TTL_SECONDS = 60 * 60 * 24;
  private static readonly ANALYSIS_CACHE_TTL_SECONDS = 60 * 60 * 24;
  private static readonly NBA_CACHE_TTL_SECONDS = 60 * 60 * 24;
  private static readonly MEDIA_CACHE_TTL_SECONDS = 60 * 60 * 6;
  private static readonly RESPONSE_CACHE_TTL_SECONDS = 60 * 10;
  private static readonly MAX_REPLY_REGENERATION_ATTEMPTS = 2;
  private static readonly MEDIA_COOLDOWN_MS = 10 * 60 * 1000;
  private static readonly SHORT_TEXT_MESSAGE_MAX_CHARS = 40;
  private static readonly LONG_AUDIO_TRANSCRIPT_MIN_CHARS = 80;
  private static readonly LONG_REPLY_MIN_CHARS = 160;
  private static readonly DEFAULT_AI_CONTEXT = [
    'Eres un asistente de ventas por WhatsApp.',
    'Responde de forma natural, clara y humana.',
    'Tu objetivo es ayudar y vender.',
  ].join('\n');

  private readonly logger = new Logger(BotService.name);

  private readonly productMediaTimestamp = new Date('2026-04-24T00:00:00.000Z');

  constructor(
    private readonly aiService: AiService,
    private readonly botConfigService: BotConfigService,
    private readonly companyContextService: CompanyContextService,
    private readonly clientConfigService: ClientConfigService,
    private readonly mediaService: MediaService,
    private readonly memoryService: MemoryService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async processIncomingMessage(
    contactId: string,
    message: string,
    metadata?: {
      messageType?: 'text' | 'audio' | 'image';
      transcript?: string | null;
    },
  ): Promise<BotReplyResult> {
    const normalizedContactId = contactId.trim();
    const normalizedMessage = message.trim();
    let userMessageStored = false;

    if (!normalizedContactId) {
      throw new BadRequestException('contactId is required');
    }

    if (!/^\+?[0-9A-Za-z._:-]{3,120}$/.test(normalizedContactId)) {
      throw new BadRequestException('contactId is invalid');
    }

    if (!normalizedMessage) {
      throw new BadRequestException('message is required');
    }

    this.logger.log(
      JSON.stringify({
        event: 'bot_message_received',
        contactId: normalizedContactId,
        message: normalizedMessage,
      }),
    );
    console.log('NUMERO:', normalizedContactId);
    console.log('MENSAJE:', normalizedMessage);

    try {
      const config = await this.clientConfigService.getConfig();
      const botConfig = await this.botConfigService.getConfig();
      const memoryWindow = config.aiSettings?.memoryWindow ?? 6;
      const allProducts = this.getProductsFromConfig(config);
      const relevantProducts = this.filterRelevantProducts(allProducts, normalizedMessage);
      console.log('PRODUCTOS:', allProducts);
      console.log('PRODUCTOS_RELEVANTES:', relevantProducts);
      const sentMediaState = await this.getSentMediaState(normalizedContactId);
      const knowledgeContext = await this.getRequiredKnowledgeContext(
        config,
        botConfig,
        normalizedMessage,
        relevantProducts,
      );

      await this.memoryService.saveMessage({
        contactId: normalizedContactId,
        role: 'user',
        content: normalizedMessage,
      });
      userMessageStored = true;

      const memoryContext = await this.memoryService.getConversationContext(
        normalizedContactId,
        memoryWindow,
      );
      const history = this.excludeCurrentUserMessage(
        memoryContext.messages,
        normalizedMessage,
      );
      const conversationMemory = await this.getConversationMemory(normalizedContactId, history);
      const usedMemory = this.hasUsefulMemory(memoryContext, history.length) || conversationMemory.lastMessages.length > 0;
      const conversationEndKey = this.getConversationEndKey(normalizedContactId);
      const conversationWasEnded = Boolean(
        await this.readRedisCache<boolean>(conversationEndKey),
      );
      const resumedByInterest = this.shouldResumeClosedConversation(normalizedMessage);

      if (conversationWasEnded && resumedByInterest) {
        await this.redisService.del(conversationEndKey);
        console.log('CONVERSATION END CLEARED:', normalizedContactId);
      }

      const closureDetected = this.shouldMarkConversationAsEnded(normalizedMessage);
      if ((closureDetected || conversationWasEnded) && !resumedByInterest) {
        await this.redisService.set(
          conversationEndKey,
          true,
          BotService.CONVERSATION_END_TTL_SECONDS,
        );

        const closureDecision = this.buildConversationEndedDecision(normalizedMessage);
        const closureReply = this.buildConversationEndedReply(
          conversationMemory,
          closureDetected,
        );

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: closureReply,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: closureReply,
            lastMessages: [normalizedMessage, closureReply],
            lastIntent: closureDecision.intent,
            state: closureDecision.stage,
            lastSentHadVideo: false,
            cooldownMediaUntil: null,
          }),
        );

        const closureResult = this.createResult(
          closureReply,
          'cierre',
          'cierre',
          closureDecision,
          false,
          [],
          'text',
          usedMemory,
        );

        await this.markBotResponseInDecisionState(
          normalizedContactId,
          closureResult.reply,
          closureDecision,
          [],
        );
        this.logReply(normalizedContactId, closureResult);
        return closureResult;
      }

      const companyData = await this.getCachedCompanyRules();
      const decision = await this.runDecisionEngine({
        contactId: normalizedContactId,
        message: normalizedMessage,
        history,
        memoryContext,
        config,
      });
      const intent = this.mapDecisionIntentToBotIntent(decision.intent, normalizedMessage);
      const hotLead = this.shouldTreatAsHotLead(
        normalizedMessage,
        intent,
        memoryContext.clientMemory.lastIntent,
      ) || decision.stage === 'listo';
      const thinkingAnalysis = this.analyzeAndThink(normalizedMessage, {
        memoryContext,
        conversationMemory,
        decision,
        intent,
        hotLead,
      });
      console.log('THINKING RESULT:', thinkingAnalysis);
      await this.redisService.set(
        this.getAnalysisCacheKey(normalizedContactId),
        {
          ...thinkingAnalysis,
          updatedAt: Date.now(),
        } satisfies AnalysisCacheEntry,
        BotService.ANALYSIS_CACHE_TTL_SECONDS,
      );
      const companyCheck = applyCompanyRules(
        normalizedMessage,
        thinkingAnalysis,
        companyData,
        new Date(Date.now()),
      );
      if (companyCheck.reason) {
        console.log('COMPANY RULE APPLIED:', companyCheck.reason);
      }
      const responseStyle = this.resolveResponseStyleFromDecision(decision, normalizedMessage, intent);
      const leadStage = this.mapDecisionStageToLeadStage(decision.stage, hotLead);
      const replyObjective = this.mapDecisionActionToReplyObjective(decision.action);
      await this.redisService.set(
        this.getNextBestActionCacheKey(normalizedContactId),
        {
          action: thinkingAnalysis.nextBestAction,
          reason: thinkingAnalysis.responseStrategy,
          updatedAt: Date.now(),
        } satisfies NextBestActionCacheEntry,
        BotService.NBA_CACHE_TTL_SECONDS,
      );

      if (!companyCheck.allowResponse && companyCheck.overrideResponse) {
        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: companyCheck.overrideResponse,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: companyCheck.overrideResponse,
            lastMessages: [normalizedMessage, companyCheck.overrideResponse],
            lastIntent: decision.intent,
            state: decision.stage,
            lastSentHadVideo: false,
            cooldownMediaUntil: null,
          }),
        );

        const blockedResult = this.createResult(
          companyCheck.overrideResponse,
          'fallback',
          intent,
          decision,
          false,
          [],
          'text',
          usedMemory,
        );

        await this.markBotResponseInDecisionState(
          normalizedContactId,
          blockedResult.reply,
          decision,
          [],
        );
        this.logReply(normalizedContactId, blockedResult);
        return blockedResult;
      }

      const mediaIntent = this.detectMediaIntent(normalizedMessage);
      const productMediaCandidates = relevantProducts.length > 0
        ? relevantProducts
        : allProducts;
      const productMediaFiles = await this.selectProductMedia(
        productMediaCandidates,
        mediaIntent,
        decision.action,
      );
      const galleryMediaFiles = productMediaFiles.length > 0
        ? productMediaFiles
        : await this.selectMedia(normalizedMessage, intent);
      const candidateMediaFiles = this.shouldAttachMediaToAiReply(
        normalizedMessage,
        intent,
        mediaIntent,
        decision.action,
        allProducts.length > 0,
        relevantProducts.length > 0,
      )
        ? this.filterConversationMediaFiles(
            this.limitOutgoingMediaFiles(galleryMediaFiles, mediaIntent, sentMediaState),
            conversationMemory,
          )
        : [];
      const responseCacheKey = this.getResponseCacheKey(
        this.buildResponseCacheHash(normalizedMessage, decision.intent, decision.stage),
      );
      const cachedResponse = await this.getCachedResponse(responseCacheKey, conversationMemory);
      if (cachedResponse) {
        const cachedDecision: BotDecisionState = {
          ...decision,
          intent: cachedResponse.decisionIntent,
          stage: cachedResponse.stage,
          action: cachedResponse.action,
          purchaseIntentScore: cachedResponse.purchaseIntentScore,
          currentIntent: cachedResponse.decisionIntent,
        };
        const cachedResult = this.createResult(
          cachedResponse.reply,
          'cache',
          cachedResponse.intent,
          cachedDecision,
          cachedResponse.hotLead,
          [],
          cachedResponse.replyType,
          usedMemory,
          true,
        );

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: cachedResult.reply,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: cachedResult.reply,
            lastMessages: [normalizedMessage, cachedResult.reply],
            lastIntent: cachedResponse.decisionIntent,
            state: cachedResponse.stage,
            lastSentHadVideo: false,
            cooldownMediaUntil: null,
          }),
        );
        await this.markBotResponseInDecisionState(
          normalizedContactId,
          cachedResult.reply,
          cachedDecision,
          [],
        );
        this.logReply(normalizedContactId, cachedResult);
        return cachedResult;
      }

      console.log('USANDO IA:', true);
      console.log('CONTEXTO LENGTH:', knowledgeContext.length);
      console.log('EMPRESA CONTEXTO:', knowledgeContext);

      const validatedReply = await this.generateValidatedReply({
        config,
        fullPrompt: this.botConfigService.getFullPrompt(botConfig),
        companyContext: knowledgeContext,
        contactId: normalizedContactId,
        message: normalizedMessage,
        history,
        context: this.buildCombinedConversationContext(knowledgeContext, memoryContext, thinkingAnalysis),
        classifiedIntent: decision.intent,
        decisionAction: decision.action,
        purchaseIntentScore: decision.purchaseIntentScore,
        responseStyle,
        leadStage,
        replyObjective,
        thinkingAnalysis,
        companyData,
        companyCheck,
        conversationMemory,
        candidateMediaFiles,
        intent,
      });
      const preferredReplyType = this.resolvePreferredReplyType({
        message: normalizedMessage,
        reply: validatedReply.reply.content,
        intent,
        action: decision.action,
        metadata,
      });

      await this.memoryService.saveMessage({
        contactId: normalizedContactId,
        role: 'assistant',
        content: validatedReply.reply.content,
      });
      await this.saveConversationMemory(
        recordConversationDelivery(conversationMemory, {
          messageText: validatedReply.reply.content,
          mediaIds: validatedReply.mediaFiles.map((file) => file.fileUrl),
          lastMessages: [normalizedMessage, validatedReply.reply.content],
          lastIntent: decision.intent,
          state: decision.stage,
          lastSentHadVideo: validatedReply.mediaFiles.some((file) => file.fileType === 'video'),
          cooldownMediaUntil:
            validatedReply.mediaFiles.length > 0
              ? Date.now() + BotService.MEDIA_COOLDOWN_MS
              : null,
        }),
      );

      const result = this.createResult(
        validatedReply.reply.content,
        validatedReply.source,
        intent,
        decision,
        hotLead,
        validatedReply.mediaFiles,
        preferredReplyType,
        usedMemory,
      );
      await this.cacheResponseIfEligible(responseCacheKey, result, conversationMemory);

      await this.markBotResponseInDecisionState(
        normalizedContactId,
        validatedReply.reply.content,
        decision,
        validatedReply.mediaFiles,
      );
      console.log('RESPUESTA FINAL:', {
        text: result.reply,
        mediaIds: result.mediaFiles.map((file) => file.fileUrl),
        source: result.source,
      });
      console.log('ENVIADA:', {
        text: result.reply,
        mediaIds: result.mediaFiles.map((file) => file.fileUrl),
      });
      this.logReply(normalizedContactId, result);
      return result;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'bot_process_failed',
          contactId: normalizedContactId,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
        error instanceof Error ? error.stack : undefined,
      );

      if (!userMessageStored) {
        try {
          await this.memoryService.saveMessage({
            contactId: normalizedContactId,
            role: 'user',
            content: normalizedMessage,
          });
        } catch {
          // Ignore fallback persistence failures.
        }
      }

      return this.buildFallbackResult(normalizedContactId, normalizedMessage);
    }
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
      memoryContext.clientMemory.objective
        ? `Objetivo principal: ${memoryContext.clientMemory.objective}`
        : null,
      memoryContext.clientMemory.interest
        ? `Interes detectado: ${memoryContext.clientMemory.interest}`
        : null,
      memoryContext.clientMemory.status && memoryContext.clientMemory.status !== 'nuevo'
        ? `Estado del cliente: ${memoryContext.clientMemory.status}`
        : null,
      (memoryContext.clientMemory.objections?.length ?? 0) > 0
        ? `Objeciones detectadas: ${memoryContext.clientMemory.objections.join(', ')}`
        : null,
    ].filter((value): value is string => Boolean(value));

    if (memoryLines.length > 0) {
      sections.push(`Memoria persistente:\n${memoryLines.join('\n')}`);
    }

    if (sections.length === 0) {
      return '';
    }

    sections.push(
      'Usa esta memoria para continuar la conversacion de forma natural, recordar datos del cliente y evitar repetir preguntas ya resueltas.',
    );
    sections.push(
      'Si el cliente ya pregunto precio, responde directo y enfoca el cierre. Si su objetivo es rebajar, resalta resultados. Si hay objeciones, responde con confianza y prueba, sin sonar robotico.',
    );

    return sections.join('\n\n');
  }

  private async getConversationMemory(
    contactId: string,
    history: StoredMessage[],
  ): Promise<ConversationMemoryState> {
    const stored = await this.redisService.get<ConversationMemoryState>(
      getConversationMemoryKey(contactId),
    );

    return normalizeConversationMemory(contactId, stored, {
      sentMessages: history
        .filter((item) => item.role === 'assistant')
        .map((item) => item.content),
      lastMessages: history.map((item) => item.content),
      state: '',
    });
  }

  private async saveConversationMemory(memory: ConversationMemoryState): Promise<void> {
    await this.redisService.set(
      getConversationMemoryKey(memory.contactId),
      memory,
      BotService.CONVERSATION_MEMORY_TTL_SECONDS,
    );
  }

  private filterConversationMediaFiles(
    mediaFiles: MediaFile[],
    conversationMemory: ConversationMemoryState,
  ): MediaFile[] {
    let videoCount = 0;

    return mediaFiles.filter((file) => {
      const mediaId = file.fileUrl.trim();
      if (!mediaId || conversationMemory.sentMedia.includes(mediaId)) {
        return false;
      }

      if (file.fileType !== 'video') {
        return true;
      }

      if (videoCount >= 1) {
        return false;
      }

      videoCount += 1;
      return true;
    });
  }

  private buildRetryInstruction(
    memory: ConversationMemoryState,
    reason: ResponseValidationReason,
    rejectedText?: string,
  ): string {
    return [
      'No repitas el mismo contenido, responde diferente.',
      `Motivo del rechazo anterior: ${reason}.`,
      rejectedText?.trim() ? `Texto rechazado: ${rejectedText.trim()}` : '',
      memory.sentMessages.length > 0
        ? `Evita estos textos exactos: ${memory.sentMessages.slice(-5).join(' | ')}`
        : '',
      'Si no hay media nueva, responde solo con texto distinto y natural.',
      'Si ya explicaste algo, avanza con otra formulacion o con una pregunta util.',
    ]
      .filter((item) => item.length > 0)
      .join('\n');
  }

  private async generateValidatedReply(params: {
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>;
    fullPrompt: string;
    companyContext: string;
    contactId: string;
    message: string;
    history: StoredMessage[];
    context: string;
    classifiedIntent: BotDecisionIntent;
    decisionAction: BotDecisionAction;
    purchaseIntentScore: number;
    responseStyle: AssistantResponseStyle;
    leadStage: AssistantLeadStage;
    replyObjective: AssistantReplyObjective;
    thinkingAnalysis: ThinkingAnalysis;
    companyData: Awaited<ReturnType<CompanyContextService['getContext']>>;
    companyCheck: CompanyRuleCheck;
    conversationMemory: ConversationMemoryState;
    candidateMediaFiles: MediaFile[];
    intent: BotIntent;
  }): Promise<{
    reply: { type: 'text' | 'audio'; content: string };
    mediaFiles: MediaFile[];
    source: BotReplyResult['source'];
  }> {
    if (params.companyCheck.reason === 'require_catalog_media' && params.candidateMediaFiles.length === 0) {
      return {
        reply: {
          type: 'text',
          content: buildCompanyRuleMediaUnavailableResponse(params.companyData),
        },
        mediaFiles: [],
        source: 'fallback',
      };
    }

    let lastRejectedText = '';
    let lastReason: ResponseValidationReason | null = null;

    for (let attempt = 0; attempt <= BotService.MAX_REPLY_REGENERATION_ATTEMPTS; attempt += 1) {
      const candidates = await this.aiService.generateResponses({
        config: params.config,
        fullPrompt: params.fullPrompt,
        companyContext: params.companyContext,
        contactId: params.contactId,
        message: params.message,
        history: params.history,
        context: [
          params.context,
          buildCompanyRuleInstruction(params.message, params.companyData, params.companyCheck),
          buildConversationMemoryContext(params.conversationMemory),
          this.buildMediaSelectionContext(params.candidateMediaFiles),
        ]
          .filter((item) => item.trim().length > 0)
          .join('\n\n'),
        classifiedIntent: params.classifiedIntent,
        decisionAction: params.decisionAction,
        purchaseIntentScore: params.purchaseIntentScore,
        responseStyle: params.responseStyle,
        leadStage: params.leadStage,
        replyObjective: params.replyObjective,
        thinkingInstruction: 'Analiza primero, luego responde sin repetir. Usa el análisis para decidir la mejor acción.',
        candidateCount: 3,
        regenerationInstruction:
          attempt > 0 && lastReason
            ? this.buildRetryInstruction(params.conversationMemory, lastReason, lastRejectedText)
            : undefined,
      });

      console.log('RESPUESTAS GENERADAS:', candidates);
      const selected = this.decideResponse(candidates, params.candidateMediaFiles, params.conversationMemory);

      if (selected) {
        const companyRuleValidation = validateCompanyRuleResponse(
          params.message,
          selected.reply.content,
          params.companyData,
          params.companyCheck,
          selected.mediaFiles.length,
        );
        if (!companyRuleValidation.valid) {
          console.log('RESPUESTA RECHAZADA:', companyRuleValidation.reason ?? 'company_rule_validation_failed');
          lastRejectedText = selected.reply.content;
          lastReason = 'no_new_content';
          continue;
        }

        console.log('RESPUESTA FINAL:', {
          text: selected.reply.content,
          mediaIds: selected.mediaFiles.map((file) => file.fileUrl),
          source: selected.source,
        });
        return selected;
      }

      const candidateFallback = this.tryBuildMediaCandidateFallback(
        params.candidateMediaFiles,
        params.conversationMemory,
      );
      if (candidateFallback) {
        console.log('RESPUESTA FINAL:', {
          text: candidateFallback.reply.content,
          mediaIds: candidateFallback.mediaFiles.map((file) => file.fileUrl),
          source: candidateFallback.source,
        });
        return candidateFallback;
      }

      lastRejectedText = candidates[0]?.text ?? '';
      lastReason = this.getLastCandidateRejectionReason(
        candidates,
        params.candidateMediaFiles,
        params.conversationMemory,
      );
    }

    return {
      reply: {
        type: 'text',
        content: this.buildNonRepeatingQuestion(
          params.message,
          params.intent,
          params.conversationMemory,
        ),
      },
      mediaFiles: [],
      source: 'fallback',
    };
  }

  private decideResponse(
    candidates: AssistantResponseCandidate[],
    candidateMediaFiles: MediaFile[],
    conversationMemory: ConversationMemoryState,
  ): {
    reply: { type: 'text' | 'audio'; content: string };
    mediaFiles: MediaFile[];
    source: BotReplyResult['source'];
  } | null {
    for (const candidate of candidates) {
      const selectedMediaFiles = this.resolveCandidateMediaFiles(candidate, candidateMediaFiles);
      const validation = validateResponseCandidate(
        {
          text: candidate.text,
          mediaIds: selectedMediaFiles.map((file) => file.fileUrl),
          videoIds: selectedMediaFiles
            .filter((file) => file.fileType === 'video')
            .map((file) => file.fileUrl),
        },
        conversationMemory,
      );

      if (!validation.valid) {
        console.log('RESPUESTA RECHAZADA:', validation.reason ?? 'no_new_content');
        continue;
      }

      return {
        reply: {
          type: candidate.type === 'audio' ? 'audio' : 'text',
          content: candidate.text,
        },
        mediaFiles: selectedMediaFiles,
        source: 'ai',
      };
    }

    return null;
  }

  private getLastCandidateRejectionReason(
    candidates: AssistantResponseCandidate[],
    candidateMediaFiles: MediaFile[],
    conversationMemory: ConversationMemoryState,
  ): ResponseValidationReason {
    for (const candidate of candidates) {
      const selectedMediaFiles = this.resolveCandidateMediaFiles(candidate, candidateMediaFiles);
      const validation = validateResponseCandidate(
        {
          text: candidate.text,
          mediaIds: selectedMediaFiles.map((file) => file.fileUrl),
          videoIds: selectedMediaFiles
            .filter((file) => file.fileType === 'video')
            .map((file) => file.fileUrl),
        },
        conversationMemory,
      );

      if (!validation.valid) {
        return validation.reason ?? 'no_new_content';
      }
    }

    return 'no_new_content';
  }

  private resolveCandidateMediaFiles(
    candidate: AssistantResponseCandidate,
    candidateMediaFiles: MediaFile[],
  ): MediaFile[] {
    if (candidate.videoId) {
      const selectedVideo = candidateMediaFiles.find(
        (file) => file.fileType === 'video' && file.fileUrl === candidate.videoId,
      );
      return selectedVideo ? [selectedVideo] : [];
    }

    if (candidate.imageId) {
      const selectedImage = candidateMediaFiles.find(
        (file) => file.fileType === 'image' && file.fileUrl === candidate.imageId,
      );
      return selectedImage ? [selectedImage] : [];
    }

    return candidateMediaFiles;
  }

  private buildMediaSelectionContext(mediaFiles: MediaFile[]): string {
    if (mediaFiles.length === 0) {
      return '';
    }

    return [
      '[MEDIA_DISPONIBLE]',
      ...mediaFiles.map((file) => {
        const kind = file.fileType === 'video' ? 'video' : 'image';
        return `- ${kind}: ${file.fileUrl}`;
      }),
      'Si eliges una media, usa exactamente la URL como videoId o imageId.',
      'Si no hace falta media nueva, omite videoId e imageId.',
    ].join('\n');
  }

  private tryBuildMediaCandidateFallback(
    candidateMediaFiles: MediaFile[],
    conversationMemory: ConversationMemoryState,
  ): {
    reply: { type: 'text' | 'audio'; content: string };
    mediaFiles: MediaFile[];
    source: BotReplyResult['source'];
  } | null {
    if (candidateMediaFiles.length === 0) {
      return null;
    }

    const mediaText = this.buildNonRepeatingMediaText(candidateMediaFiles, conversationMemory);
    if (!mediaText) {
      return null;
    }

    const validation = validateResponseCandidate(
      {
        text: mediaText,
        mediaIds: candidateMediaFiles.map((file) => file.fileUrl),
        videoIds: candidateMediaFiles
          .filter((file) => file.fileType === 'video')
          .map((file) => file.fileUrl),
      },
      conversationMemory,
    );

    if (!validation.valid) {
      console.log('RESPUESTA RECHAZADA:', validation.reason ?? 'no_new_content');
      return null;
    }

    return {
      reply: {
        type: 'text',
        content: mediaText,
      },
      mediaFiles: candidateMediaFiles,
      source: 'ai',
    };
  }

  private pickFirstUnsentMessage(options: string[], sentMessages: string[]): string {
    const normalizedOptions = options
      .map((option) => option.trim())
      .filter((option) => option.length > 0);

    return normalizedOptions.find((option) => !sentMessages.includes(option))
      ?? normalizedOptions[0]
      ?? 'Quieres que te ayude por precio, resultados o como se usa?';
  }

  private buildNonRepeatingQuestion(
    message: string,
    intent: BotIntent,
    conversationMemory: ConversationMemoryState,
  ): string {
    const normalized = this.normalizeTextForMatch(message);

    if (intent === 'duda' || normalized.includes('funciona') || normalized.includes('sirve')) {
      return this.pickFirstUnsentMessage([
        'Que duda te preocupa mas ahora, si funciona, como se usa o en cuanto tiempo se nota?',
        'Quieres que te aclare primero si funciona, como se toma o que resultados suele notar la gente?',
        'Dime que parte quieres que te explique mejor: funcionamiento, uso o resultados?',
      ], conversationMemory.sentMessages);
    }

    if (intent === 'compra' || intent === 'interes' || normalized.includes('precio')) {
      return this.pickFirstUnsentMessage([
        'Que te interesa mas ahora, precio, resultados o como pedirlo?',
        'Quieres que te diga primero el precio, como se usa o como seria el pedido?',
        'Prefieres que te explique precio, uso o la forma de envio?',
      ], conversationMemory.sentMessages);
    }

    return this.pickFirstUnsentMessage([
      'Que quieres ver ahora, precio, fotos o como funciona?',
      'Quieres que te ayude por precio, resultados o modo de uso?',
      'Dime que prefieres que te explique primero: precio, uso o resultados?',
    ], conversationMemory.sentMessages);
  }

  private buildNonRepeatingMediaText(
    mediaFiles: MediaFile[],
    conversationMemory: ConversationMemoryState,
  ): string | null {
    if (mediaFiles.some((file) => file.fileType === 'video')) {
      return this.pickFirstUnsentMessage([
        'Te dejo este video para que lo veas mejor 👆',
        'Mira este video y me dices que te parece 👆',
        'Te mando este video para que lo veas claro 👆',
      ], conversationMemory.sentMessages);
    }

    if (mediaFiles.some((file) => file.fileType === 'image')) {
      return this.pickFirstUnsentMessage([
        'Te dejo otra referencia por aquí 👇',
        'Mira esta otra imagen para que lo veas mejor 👇',
        'Te mando otra referencia visual 👇',
      ], conversationMemory.sentMessages);
    }

    return null;
  }

  private buildFallbackDecisionState(contactId: string, message: string): BotDecisionState {
    return {
      intent: 'otro',
      classificationSource: 'heuristic_fallback',
      stage: 'curioso',
      action: 'guiar',
      purchaseIntentScore: 0,
      currentIntent: 'otro',
      summaryText: 'Fallback temporal por error interno.',
      keyFacts: {},
      lastMessageId: this.buildSyntheticMessageId(contactId, message),
    };
  }

  private async buildFallbackResult(
    contactId: string,
    message: string,
  ): Promise<BotReplyResult> {
    const conversationMemory = await this.getConversationMemory(contactId, []);
    const fallbackReply = this.pickFirstUnsentMessage([
      'Ahora mismo estoy cargando la información, dame un momentico 🙏',
      'Dame un momentico 🙏 estoy terminando de cargar la información para responderte bien.',
      'Estoy cargando la información para responderte mejor, dame un momentico 🙏',
      this.buildNonRepeatingQuestion(message, this.detectIntent(message), conversationMemory),
    ], conversationMemory.sentMessages);

    try {
      await this.memoryService.saveMessage({
        contactId,
        role: 'assistant',
        content: fallbackReply,
      });
      await this.saveConversationMemory(
        recordConversationDelivery(conversationMemory, {
          messageText: fallbackReply,
          lastMessages: [message, fallbackReply],
          lastIntent: this.detectIntent(message),
          lastSentHadVideo: false,
          cooldownMediaUntil: null,
        }),
      );
    } catch {
      // Ignore fallback persistence failures.
    }

    const result = this.createResult(
      fallbackReply,
      'fallback',
      this.detectIntent(message),
      this.buildFallbackDecisionState(contactId, message),
      false,
      [],
      'text',
      conversationMemory.lastMessages.length > 0,
    );

    console.log('RESPUESTA FINAL:', {
      text: result.reply,
      mediaIds: [],
      source: result.source,
    });
    console.log('ENVIADA:', {
      text: result.reply,
      mediaIds: [],
    });
    return result;
  }

  private buildCombinedConversationContext(
    knowledgeContext: string,
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
    thinkingAnalysis?: ThinkingAnalysis,
  ): string {
    const conversationContext = this.buildConversationContext(memoryContext);
    const thinkingContext = thinkingAnalysis
      ? this.buildThinkingContext(thinkingAnalysis)
      : '';

    return [knowledgeContext.trim(), conversationContext.trim(), thinkingContext.trim()]
      .filter((section) => section.length > 0)
      .join('\n\n');
  }

  private analyzeAndThink(
    userMessage: string,
    state: {
      memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>;
      conversationMemory: ConversationMemoryState;
      decision: BotDecisionState;
      intent: BotIntent;
      hotLead: boolean;
    },
  ): ThinkingAnalysis {
    const normalizedMessage = this.normalizeTextForMatch(userMessage);
    const assistantHistory = state.memoryContext.messages.filter((item) => item.role === 'assistant');
    const userHistory = state.memoryContext.messages.filter((item) => item.role === 'user');
    const alreadyExplained = assistantHistory.some((item) =>
      /funciona|sirve|precio|se usa|beneficio|resultado|explico/i.test(item.content),
    ) || Boolean(state.memoryContext.summary.summary?.trim());
    const repetitionRisk =
      state.conversationMemory.sentMessages.length > 0 && (
        state.conversationMemory.lastMessages.some((item) => this.normalizeTextForMatch(item) === normalizedMessage)
        || this.hasShortBackAndForthLoop(userHistory)
      );

    const userState: ThinkingAnalysis['userState'] = state.hotLead
      ? 'listo'
      : state.decision.stage === 'interesado'
        ? 'interesado'
        : state.decision.stage === 'dudoso'
          ? 'interesado'
          : state.memoryContext.messages.length <= 2
            ? 'frio'
            : 'curioso';

    let nextBestAction: ThinkingAnalysis['nextBestAction'] = 'avanzar';
    let responseStrategy = 'responder natural y mover la conversacion.';

    if (state.hotLead || state.decision.action === 'cerrar') {
      nextBestAction = 'cerrar';
      responseStrategy = 'cerrar suave y llevar al siguiente paso de compra.';
    } else if (repetitionRisk && alreadyExplained) {
      nextBestAction = 'avanzar';
      responseStrategy = 'no repetir, resumir brevemente y llevar a precio o siguiente paso.';
    } else if (alreadyExplained) {
      nextBestAction = 'resumir';
      responseStrategy = 'resumir lo esencial sin explicar otra vez y empujar la conversacion.';
    } else if (state.intent === 'duda' || state.decision.action === 'persuadir') {
      nextBestAction = 'explicar';
      responseStrategy = 'explicar claro, resolver la duda y cerrar con una pregunta util.';
    } else if (state.intent === 'interes' || state.intent === 'compra') {
      nextBestAction = 'avanzar';
      responseStrategy = 'ser directo, responder valor y mover a precio o compra.';
    } else {
      nextBestAction = 'preguntar';
      responseStrategy = 'responder corto y hacer una sola pregunta para avanzar sin caer en bucle.';
    }

    return {
      intent: state.decision.intent,
      userState,
      alreadyExplained,
      repetitionRisk,
      nextBestAction,
      responseStrategy,
    };
  }

  private hasShortBackAndForthLoop(userHistory: StoredMessage[]): boolean {
    const recentUserMessages = userHistory
      .slice(-3)
      .map((item) => this.normalizeTextForMatch(item.content))
      .filter((item) => item.length > 0);

    if (recentUserMessages.length < 2) {
      return false;
    }

    return new Set(recentUserMessages).size < recentUserMessages.length;
  }

  private buildThinkingContext(analysis: ThinkingAnalysis): string {
    return [
      '[THINKING_RESULT]',
      `intent: ${analysis.intent}`,
      `userState: ${analysis.userState}`,
      `alreadyExplained: ${analysis.alreadyExplained ? 'true' : 'false'}`,
      `repetitionRisk: ${analysis.repetitionRisk ? 'true' : 'false'}`,
      `nextBestAction: ${analysis.nextBestAction}`,
      `responseStrategy: ${analysis.responseStrategy}`,
      'Usa este análisis para decidir si conviene explicar, resumir, preguntar, avanzar o cerrar.',
      'Si ya se explicó lo suficiente, no expliques dos veces lo mismo.',
      'Si no hay valor nuevo, pregunta. Si hay interés, avanza a compra con naturalidad.',
    ].join('\n');
  }

  private async getRequiredKnowledgeContext(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
    botConfig: Awaited<ReturnType<BotConfigService['getConfig']>>,
    message: string,
    relevantProducts: StructuredProduct[],
  ): Promise<string> {
    const cached = await this.redisService.get<string>(BotService.KNOWLEDGE_CONTEXT_CACHE_KEY);
    const baseContext = cached?.trim() || (await this.buildAndCacheBaseKnowledgeContext(config, botConfig));
    const relevantProductsBlock = this.buildProductsKnowledgeBlock(relevantProducts);

    if (!relevantProductsBlock || !baseContext.includes('[PRODUCTOS]')) {
      return baseContext;
    }

    return this.appendRelevantProductsSection(baseContext, relevantProductsBlock);
  }

  private async buildAndCacheBaseKnowledgeContext(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
    botConfig: Awaited<ReturnType<BotConfigService['getConfig']>>,
  ): Promise<string> {
    const cached = await this.redisService.get<string>(BotService.KNOWLEDGE_CONTEXT_CACHE_KEY);
    if (cached?.trim()) {
      return cached.trim();
    }

    const instructionsBlock = this.buildInstructionsKnowledgeBlock(config, botConfig);
    const productsBlock = this.buildProductsKnowledgeBlock(this.getProductsFromConfig(config));
    const companyBlock = (await this.companyContextService.buildAgentContext()).trim();

    const sections: string[] = [
      '[INSTRUCCIONES]',
      instructionsBlock || 'Sin instrucciones configuradas. Usa el prompt base sin inventar datos ni romper el tono comercial.',
      '[PRODUCTOS]',
      productsBlock || 'Catalogo no configurado. No inventes productos ni beneficios.',
      '[EMPRESA]',
      companyBlock || 'Informacion de empresa no configurada. Si preguntan horario, ubicacion, pago o contacto, responde solo con lo que este disponible sin inventar.',
    ];

    sections.push(
      'Regla critica: antes de responder, usa SIEMPRE [INSTRUCCIONES] como comportamiento y [PRODUCTOS] como fuente principal de datos.',
    );
    sections.push(
      'Lee el catalogo completo antes de responder. Si existe un producto relevante, usa siempre su titulo, descripcion, precio, imagenes y videos antes de inferir o improvisar.',
    );
    sections.push(
      'Si hay media disponible en productos o galeria y ayuda a vender, priorizala. No digas que no hay fotos o videos sin revisar primero las URLs disponibles.',
    );
    sections.push(
      'Usa el contexto disponible como base de la respuesta. Si falta alguna parte, responde natural, clara y orientada a vender sin inventar datos.',
    );

    const knowledgeContext = sections.join('\n\n');

    await this.redisService.set(BotService.KNOWLEDGE_CONTEXT_CACHE_KEY, knowledgeContext);
    return knowledgeContext;
  }

  private buildInstructionsKnowledgeBlock(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
    botConfig: Awaited<ReturnType<BotConfigService['getConfig']>>,
  ): string {
    const configurations = this.asRecord(config.configurations);
    const structuredInstructions = this.asRecord(configurations.instructions);
    const identity = this.asRecord(structuredInstructions.identity);
    const rules = this.asStringList(structuredInstructions.rules);
    const salesPrompts = this.asRecord(structuredInstructions.salesPrompts);
    const prompts = this.asRecord(configurations.prompts);
    const sections: string[] = [];

    this.appendLabeledValue(sections, 'Prompt base del sistema', config.promptBase);
    this.appendLabeledValue(
      sections,
      'Prompt maestro comercial',
      this.botConfigService.getFullPrompt(botConfig),
    );
    this.appendLabeledValue(sections, 'Nombre interno del bot', identity.assistantName);
    this.appendLabeledValue(sections, 'Rol comercial', identity.role);
    this.appendLabeledValue(sections, 'Objetivo principal', identity.objective);
    this.appendLabeledValue(sections, 'Tono de voz', identity.tone);
    this.appendLabeledValue(sections, 'Personalidad', identity.personality);
    this.appendLabeledValue(sections, 'Estilo de respuesta', identity.responseStyle);
    this.appendLabeledValue(sections, 'Firma sugerida', identity.signature);
    this.appendLabeledValue(sections, 'Guardrails', identity.guardrails);

    if (rules.length > 0) {
      sections.push(`Reglas:\n${rules.map((rule) => `- ${rule}`).join('\n')}`);
    }

    this.appendLabeledValue(sections, 'Apertura', salesPrompts.opening);
    this.appendLabeledValue(sections, 'Calificacion', salesPrompts.qualification);
    this.appendLabeledValue(sections, 'Oferta', salesPrompts.offer);
    this.appendLabeledValue(sections, 'Objeciones', salesPrompts.objectionHandling);
    this.appendLabeledValue(sections, 'Cierre', salesPrompts.closing);
    this.appendLabeledValue(sections, 'Seguimiento', salesPrompts.followUp);
    this.appendLabeledValue(sections, 'Informacion de empresa legacy', prompts.companyInfo);
    this.appendLabeledValue(sections, 'Guia comercial legacy', prompts.salesGuidelines);
    this.appendLabeledValue(sections, 'Objeciones legacy', prompts.objectionHandling);
    this.appendLabeledValue(sections, 'Cierre legacy', prompts.closingPrompt);

    return sections.join('\n\n').trim();
  }

  private buildProductsKnowledgeBlock(products: StructuredProduct[]): string {
    return products
      .map((item) => this.formatProductKnowledgeBlock(item))
      .filter((item): item is string => item.length > 0)
      .join('\n\n')
      .trim();
  }

  private getRelevantProducts(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
    message: string,
  ): StructuredProduct[] {
    return this.filterRelevantProducts(this.getProductsFromConfig(config), message);
  }

  private getProductsFromConfig(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
  ): StructuredProduct[] {
    const configurations = this.asRecord(config.configurations);
    const structuredInstructions = this.asRecord(configurations.instructions);
    const rawProducts = Array.isArray(structuredInstructions.products)
      ? structuredInstructions.products
      : [];

    return rawProducts
      .map((value) => this.normalizeProduct(value))
      .filter((product): product is StructuredProduct => Boolean(product && product.activo));
  }

  private filterRelevantProducts(values: StructuredProduct[], message: string): StructuredProduct[] {
    const normalizedMessage = this.normalizeTextForMatch(message);
    if (!normalizedMessage) {
      return [];
    }

    const terms = normalizedMessage
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3);

    if (terms.length === 0) {
      return [];
    }

    const matchedProducts = values.filter((value) => {
      const haystack = this.normalizeTextForMatch(
        [
          value.titulo,
          value.descripcionCorta,
          value.descripcionCompleta,
          this.valueToText(value.precio),
          this.valueToText(value.precioMinimo),
        ]
          .map((item) => item.trim())
          .join(' '),
      );

      return terms.some((term) => haystack.includes(term));
    });

    if (matchedProducts.length > 0) {
      return matchedProducts;
    }

    if (
      values.length === 1 &&
      this.isGenericPriceQuestion(normalizedMessage) &&
      (values[0]?.imagenes.length ?? 0) + (values[0]?.videos.length ?? 0) > 0
    ) {
      return values;
    }

    return [];
  }

  private isGenericPriceQuestion(message: string): boolean {
    return ['precio', 'precio?', 'cuanto cuesta', 'cuánto cuesta', 'cuanto vale', 'cuánto vale'].includes(message);
  }

  private appendRelevantProductsSection(baseContext: string, productsBlock: string): string {
    if (!productsBlock.trim()) {
      return baseContext;
    }

    const relevantSection = [
      '[PRODUCTOS_RELEVANTES]',
      productsBlock,
      'Usa primero estos productos relevantes para responder y vender. Si vas a enviar media, toma primero sus imagenes o videos.',
    ].join('\n\n');

    if (baseContext.includes('[PRODUCTOS_RELEVANTES]')) {
      return baseContext.replace(
        /\[PRODUCTOS_RELEVANTES\][\s\S]*?(?=\n\n\[EMPRESA\]|$)/,
        relevantSection,
      );
    }

    if (baseContext.includes('[EMPRESA]')) {
      return baseContext.replace(/\n\n\[EMPRESA\]/, `\n\n${relevantSection}\n\n[EMPRESA]`);
    }

    return `${baseContext}\n\n${relevantSection}`;
  }

  private normalizeTextForMatch(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  }

  private formatProductKnowledgeBlock(product: StructuredProduct): string {
    if (!product.titulo) {
      return '';
    }

    const lines = [
      product.titulo,
      this.formatKnowledgeField('ID', product.id),
      this.formatKnowledgeField('Descripcion corta', product.descripcionCorta),
      this.formatKnowledgeField('Descripcion completa', product.descripcionCompleta),
      this.formatKnowledgeField('Precio', this.valueToText(product.precio)),
      this.formatKnowledgeField('Precio minimo', this.valueToText(product.precioMinimo)),
      this.formatKnowledgeField('Imagenes', product.imagenes.join(', ')),
      this.formatKnowledgeField('Videos', product.videos.join(', ')),
      this.formatKnowledgeField('Activo', product.activo ? 'si' : 'no'),
    ].filter((line) => line.length > 0);

    return lines.join('\n');
  }

  private normalizeProduct(value: unknown): StructuredProduct | null {
    const product = this.asRecord(value);
    const titulo =
      this.asString(product.titulo) ||
      this.asString(product.title) ||
      this.asString(product.name);

    if (!titulo) {
      return null;
    }

    const descripcionCorta =
      this.asString(product.descripcion_corta) ||
      this.asString(product.descripcionCorta) ||
      this.asString(product.summary);
    const descripcionCompleta =
      this.asString(product.descripcion_completa) ||
      this.asString(product.descripcionCompleta) ||
      this.asString(product.description) ||
      [
        this.asString(product.benefits),
        this.asString(product.usage),
        this.asString(product.notes),
      ]
        .filter((item) => item.length > 0)
        .join(' ');

    return {
      id: this.asString(product.id) || titulo,
      titulo,
      descripcionCorta,
      descripcionCompleta,
      precio: this.readScalarValue(product.precio, product.price),
      precioMinimo: this.readScalarValue(product.precio_minimo, product.precioMinimo),
      imagenes: this.asStringList(product.imagenes),
      videos: this.asStringList(product.videos),
      activo: this.readBoolean(product.activo, product.active, true),
    };
  }

  private appendLabeledValue(sections: string[], label: string, value: unknown): void {
    const content = this.asString(value);
    if (!content) {
      return;
    }

    sections.push(`${label}:\n${content}`);
  }

  private formatKnowledgeField(label: string, value: unknown): string {
    const content = this.asString(value);
    return content ? `- ${label}: ${content}` : '';
  }

  private async getSentMediaState(contactId: string): Promise<SentMediaState> {
    const cachedSentMediaUrls = await this.redisService.get<string[]>(
      `${BotService.SENT_MEDIA_CACHE_KEY_PREFIX}${contactId}`,
    );
    if (Array.isArray(cachedSentMediaUrls) && cachedSentMediaUrls.length > 0) {
      return {
        sentMediaUrls: cachedSentMediaUrls.filter((url) => typeof url === 'string' && url.trim().length > 0),
      };
    }

    const currentState = await this.prisma.contactState.findUnique({
      where: { contactId },
    });
    const notes = this.asRecord(currentState?.notesJson);

    return {
      sentMediaUrls: this.asStringList(notes.sentMediaUrls),
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readScalarValue(...values: unknown[]): string | number | null {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return null;
  }

  private readBoolean(...values: unknown[]): boolean {
    for (const value of values) {
      if (typeof value === 'boolean') {
        return value;
      }
    }

    return true;
  }

  private valueToText(value: string | number | null): string {
    if (typeof value === 'number') {
      return value.toString();
    }

    return value?.trim() || '';
  }

  private asStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private async selectMedia(message: string, intent: BotIntent) {
    const queryCacheKey = `media_cache:query:${this.hashValue(this.normalizeTextForMatch(message))}`;
    const cached = await this.readRedisCache<MediaFile[]>(queryCacheKey);
    if (Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    const take = intent === 'catalogo' || this.isVisualRequest(message) ? 5 : 3;
    const media = await this.mediaService.getMediaByKeyword(message, take);
    await this.redisService.set(queryCacheKey, media, BotService.MEDIA_CACHE_TTL_SECONDS);
    return media;
  }

  private detectMediaIntent(message: string): MediaIntent {
    const normalized = this.normalizeTextForMatch(message);
    if (!normalized) {
      return null;
    }

    const wantsImage = ['foto', 'fotos', 'imagen', 'imagenes', 'ver'].some((keyword) => normalized.includes(keyword));
    const wantsVideo = ['video', 'videos'].some((keyword) => normalized.includes(keyword));
    const wantsMedia = ['muestra', 'muestrame', 'como es', 'cómo es'].some((keyword) => normalized.includes(keyword));

    if (wantsImage && wantsVideo) {
      return 'MEDIA';
    }

    if (wantsVideo) {
      return 'VIDEO';
    }

    if (wantsImage) {
      return 'IMAGEN';
    }

    if (wantsMedia) {
      return 'MEDIA';
    }

    return null;
  }

  private async selectProductMedia(
    products: StructuredProduct[],
    mediaIntent: MediaIntent,
    action: BotDecisionAction,
  ): Promise<MediaFile[]> {
    if (products.length === 0) {
      return [];
    }

    const cachedProducts = await Promise.all(products.map(async (product) => {
      const key = `media_cache:${product.id}`;
      const cached = await this.readRedisCache<MediaCacheEntry>(key);
      if (cached) {
        return {
          ...product,
          imagenes: cached.images,
          videos: cached.videos,
        };
      }

      await this.redisService.set(
        key,
        {
          images: product.imagenes,
          videos: product.videos,
          updatedAt: Date.now(),
        } satisfies MediaCacheEntry,
        BotService.MEDIA_CACHE_TTL_SECONDS,
      );

      return product;
    }));

    if (mediaIntent === 'VIDEO') {
      return this.mapProductMedia(cachedProducts, 'video', 1);
    }

    if (mediaIntent === 'IMAGEN') {
      return this.mapProductMedia(cachedProducts, 'image', 3);
    }

    if (mediaIntent === 'MEDIA') {
      const images = this.mapProductMedia(cachedProducts, 'image', 3);
      return images.length > 0 ? images : this.mapProductMedia(cachedProducts, 'video', 1);
    }

    if (
      action === 'cerrar' ||
      action === 'responder_precio_con_valor' ||
      action === 'persuadir' ||
      action === 'guiar'
    ) {
      return this.mapProductMedia(cachedProducts, 'image', 1);
    }

    return [];
  }

  private mapProductMedia(
    products: StructuredProduct[],
    fileType: 'image' | 'video',
    take: number,
  ): MediaFile[] {
    const urls = products.flatMap((product) => {
      const mediaUrls = fileType === 'image' ? product.imagenes : product.videos;
      return mediaUrls.map((url) => ({ product, url }));
    });

    return urls.slice(0, take).map(({ product, url }, index) => ({
      id: -1 - index,
      title: product.titulo,
      description: product.descripcionCorta || product.descripcionCompleta || null,
      fileUrl: url,
      fileType,
      createdAt: this.productMediaTimestamp,
    }));
  }

  private limitOutgoingMediaFiles(
    mediaFiles: MediaFile[],
    mediaIntent: MediaIntent,
    sentMediaState: SentMediaState,
  ): MediaFile[] {
    const unseenMediaFiles = mediaFiles.filter(
      (file) => !sentMediaState.sentMediaUrls.includes(file.fileUrl),
    );
    const sourceFiles = unseenMediaFiles.length > 0 ? unseenMediaFiles : mediaFiles;

    if (mediaIntent === 'VIDEO') {
      return sourceFiles.filter((file) => file.fileType === 'video').slice(0, 1);
    }

    if (mediaIntent === 'IMAGEN' || mediaIntent === 'MEDIA') {
      return sourceFiles.filter((file) => file.fileType === 'image').slice(0, 2);
    }

    const images = sourceFiles.filter((file) => file.fileType === 'image').slice(0, 2);
    if (images.length > 0) {
      return images;
    }

    return sourceFiles.filter((file) => file.fileType === 'video').slice(0, 1);
  }

  private buildFastLaneReply(params: {
    message: string;
    intent: BotIntent;
    hotLead: boolean;
    mediaFiles: Awaited<ReturnType<BotService['getMediaByKeyword']>>;
    preferredReplyType: BotReplyResult['replyType'];
    responseStyle: AssistantResponseStyle;
    decision: BotDecisionState;
    usedMemory: boolean;
  }): BotReplyResult | null {
    if (
      this.requiresDetailedResponse(params.message) ||
      this.requiresSpecificDirectAnswer(params.message, params.intent)
    ) {
      return null;
    }

    if (params.mediaFiles.length > 0) {
      const galleryReply = params.intent === 'catalogo'
        ? 'Claro 👍 mira el catálogo aquí.'
        : 'Claro 👌 mira esta referencia.';

      return this.createResult(
        galleryReply,
        'galeria',
        params.intent,
        params.decision,
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
    decision: BotDecisionState,
    hotLead: boolean,
    mediaFiles: Awaited<ReturnType<BotService['getMediaByKeyword']>>,
    replyType: BotReplyResult['replyType'],
    usedMemory: boolean,
    cached = false,
  ): BotReplyResult {
    return {
      reply,
      replyType,
      mediaFiles,
      intent,
      decisionIntent: decision.intent,
      stage: decision.stage,
      action: decision.action,
      purchaseIntentScore: decision.purchaseIntentScore,
      hotLead,
      cached,
      usedGallery: mediaFiles.length > 0,
      usedMemory,
      source,
    };
  }

  private getIntentCacheKey(contactId: string): string {
    return `intent:${contactId}`;
  }

  private getConversationEndKey(contactId: string): string {
    return `conversation_end:${contactId}`;
  }

  private getStateCacheKey(contactId: string): string {
    return `state:${contactId}`;
  }

  private getAnalysisCacheKey(contactId: string): string {
    return `analysis:${contactId}`;
  }

  private getNextBestActionCacheKey(contactId: string): string {
    return `nba:${contactId}`;
  }

  private getResponseCacheKey(hash: string): string {
    return `response_cache:${hash}`;
  }

  private buildResponseCacheHash(
    message: string,
    intent: BotDecisionIntent,
    stage: ContactStage,
  ): string {
    return this.hashValue(`${this.normalizeTextForMatch(message)}|${intent}|${stage}`);
  }

  private hashValue(value: string): string {
    return createHash('sha1').update(value).digest('hex');
  }

  private async readRedisCache<T>(key: string): Promise<T | null> {
    const value = await this.redisService.get<T>(key);
    console.log(value === null ? 'REDIS MISS:' : 'REDIS HIT:', key);
    return value;
  }

  private async getCachedCompanyRules(): Promise<Awaited<ReturnType<CompanyContextService['getContext']>>> {
    const cached = await this.readRedisCache<Awaited<ReturnType<CompanyContextService['getContext']>>>(
      BotService.COMPANY_RULES_CACHE_KEY,
    );
    if (cached) {
      return cached;
    }

    const companyData = await this.companyContextService.getContext();
    await this.redisService.set(
      BotService.COMPANY_RULES_CACHE_KEY,
      companyData,
      BotService.STATE_CACHE_TTL_SECONDS,
    );
    return companyData;
  }

  private areMessagesSimilar(left: string, right: string): boolean {
    const normalizedLeft = this.normalizeTextForMatch(left);
    const normalizedRight = this.normalizeTextForMatch(right);

    if (!normalizedLeft || !normalizedRight) {
      return false;
    }

    return normalizedLeft === normalizedRight
      || normalizedLeft.includes(normalizedRight)
      || normalizedRight.includes(normalizedLeft);
  }

  private async getCachedResponse(
    key: string,
    conversationMemory: ConversationMemoryState,
  ): Promise<ResponseCacheEntry | null> {
    const cached = await this.readRedisCache<ResponseCacheEntry>(key);
    if (!cached) {
      return null;
    }

    if (conversationMemory.sentMessages.includes(cached.reply)) {
      return null;
    }

    return cached;
  }

  private async cacheResponseIfEligible(
    key: string,
    result: BotReplyResult,
    conversationMemory: ConversationMemoryState,
  ): Promise<void> {
    if (result.mediaFiles.length > 0 || result.source === 'fallback') {
      return;
    }

    if (conversationMemory.sentMessages.includes(result.reply)) {
      return;
    }

    await this.redisService.set(
      key,
      {
        reply: result.reply,
        replyType: result.replyType,
        intent: result.intent,
        decisionIntent: result.decisionIntent,
        stage: result.stage,
        action: result.action,
        purchaseIntentScore: result.purchaseIntentScore,
        hotLead: result.hotLead,
        source: result.source,
        updatedAt: Date.now(),
      } satisfies ResponseCacheEntry,
      BotService.RESPONSE_CACHE_TTL_SECONDS,
    );
  }

  private resolvePreferredReplyType(params: {
    message: string;
    reply: string;
    intent: BotIntent;
    action: BotDecisionAction;
    metadata?: {
      messageType?: 'text' | 'audio' | 'image';
      transcript?: string | null;
    };
  }): BotReplyResult['replyType'] {
    const incoming = this.analyzeIncomingMessage(params.message, params.metadata);
    if (this.shouldUseTextReply(params.message, params.intent, params.action, incoming)) {
      return 'text';
    }

    const modalityIntent = this.detectReplyModalityIntent(
      params.message,
      params.intent,
      params.action,
    );

    if (
      modalityIntent === 'precio' ||
      modalityIntent === 'confirmacion' ||
      modalityIntent === 'compra' ||
      modalityIntent === 'cierre'
    ) {
      return 'text';
    }

    if (this.shouldUseAudioReply(params.message, params.reply, params.action, incoming)) {
      return 'audio';
    }

    return 'text';
  }

  private detectReplyModalityIntent(
    message: string,
    intent: BotIntent,
    action: BotDecisionAction,
  ): 'precio' | 'confirmacion' | 'compra' | 'cierre' | 'explicacion' | 'general' {
    const normalized = this.normalizeTextForMatch(message);

    if (!normalized) {
      return 'general';
    }

    if (action === 'cerrar' || intent === 'cierre') {
      return 'cierre';
    }

    if (['precio', 'cuanto', 'cuánto', 'vale'].some((keyword) => normalized.includes(keyword))) {
      return 'precio';
    }

    if (['ok', 'dale', 'perfecto', 'listo'].includes(normalized)) {
      return 'confirmacion';
    }

    if (
      ['como funciona', 'cómo funciona', 'explicame', 'explícame', 'que es', 'qué es']
        .some((keyword) => normalized.includes(keyword))
    ) {
      return 'explicacion';
    }

    if (
      ['quiero comprar', 'lo quiero', 'enviamelo', 'enviamelo']
        .some((keyword) => normalized.includes(keyword))
    ) {
      return 'compra';
    }

    return 'general';
  }

  private analyzeIncomingMessage(
    message: string,
    metadata?: {
      messageType?: 'text' | 'audio' | 'image';
      transcript?: string | null;
    },
  ): {
    messageType: 'text' | 'audio' | 'image';
    messageLength: 'corto' | 'medio' | 'largo';
  } {
    const messageType = metadata?.messageType === 'audio' || metadata?.messageType === 'image'
      ? metadata.messageType
      : 'text';
    const normalizedTranscript = (metadata?.transcript ?? message).trim();
    const size = normalizedTranscript.length;

    if (messageType === 'audio') {
      if (size > BotService.LONG_AUDIO_TRANSCRIPT_MIN_CHARS) {
        return { messageType, messageLength: 'largo' };
      }

      if (size >= BotService.SHORT_TEXT_MESSAGE_MAX_CHARS) {
        return { messageType, messageLength: 'medio' };
      }

      return { messageType, messageLength: 'corto' };
    }

    if (size < BotService.SHORT_TEXT_MESSAGE_MAX_CHARS) {
      return { messageType, messageLength: 'corto' };
    }

    if (size >= BotService.LONG_REPLY_MIN_CHARS) {
      return { messageType, messageLength: 'largo' };
    }

    return { messageType, messageLength: 'medio' };
  }

  private shouldUseTextReply(
    message: string,
    intent: BotIntent,
    action: BotDecisionAction,
    incoming: { messageType: 'text' | 'audio' | 'image'; messageLength: 'corto' | 'medio' | 'largo' },
  ): boolean {
    const normalized = this.normalizeTextForMatch(message);

    if (!normalized) {
      return true;
    }

    if (action === 'cerrar' || intent === 'cierre') {
      return true;
    }

    if (this.requiresSpecificDirectAnswer(message, intent)) {
      return true;
    }

    if (this.isSimpleConfirmation(normalized) || this.isGreetingMessage(normalized)) {
      return true;
    }

    return incoming.messageType === 'text' && incoming.messageLength === 'corto' && !this.requiresDetailedResponse(message);
  }

  private shouldUseAudioReply(
    message: string,
    reply: string,
    action: BotDecisionAction,
    incoming: { messageType: 'text' | 'audio' | 'image'; messageLength: 'corto' | 'medio' | 'largo' },
  ): boolean {
    const explicitVoicePreference = this.prefersVoiceReply(message);
    const detailedRequest = this.requiresDetailedResponse(message);
    const instructionRequest = this.requiresInstructionalWalkthrough(message);
    const emotionalSalesReply = this.isEmotionalSalesReply(reply, action);
    const longOrDetailedReply = this.isLongOrDetailedReply(reply);
    const voiceSuitableReply = longOrDetailedReply || this.isVoiceSuitableReply(reply);

    if (!voiceSuitableReply && !emotionalSalesReply) {
      return false;
    }

    if (incoming.messageType === 'audio' && incoming.messageLength !== 'corto') {
      if (action === 'persuadir' || detailedRequest || instructionRequest || explicitVoicePreference) {
        return true;
      }
    }

    if (incoming.messageType === 'text' && incoming.messageLength === 'largo') {
      return detailedRequest || instructionRequest || emotionalSalesReply || explicitVoicePreference;
    }

    if (explicitVoicePreference && (detailedRequest || instructionRequest || voiceSuitableReply)) {
      return true;
    }

    if (action === 'persuadir' && (voiceSuitableReply || emotionalSalesReply)) {
      return true;
    }

    return detailedRequest || instructionRequest;
  }

  private isVoiceSuitableReply(reply: string): boolean {
    const normalized = reply.trim();
    if (!normalized) {
      return false;
    }

    const words = normalized.split(/\s+/).filter((word) => word.length > 0);
    if (words.length >= 18) {
      return true;
    }

    return normalized.length >= 95;
  }

  private requiresInstructionalWalkthrough(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'como se usa',
      'cómo se usa',
      'como lo uso',
      'cómo lo uso',
      'como tomarlo',
      'cómo tomarlo',
      'como me lo tomo',
      'cómo me lo tomo',
      'paso por paso',
      'pasos',
      'instrucciones',
    ].some((keyword) => normalized.includes(keyword));
  }

  private isEmotionalSalesReply(reply: string, action: BotDecisionAction): boolean {
    if (action !== 'persuadir') {
      return false;
    }

    const normalized = reply.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'te explico',
      'te puede ayudar',
      'vas a sentir',
      'vas a notar',
      'te va a ayudar',
      'lo importante es',
      'mira',
    ].some((keyword) => normalized.includes(keyword));
  }

  private isSimpleConfirmation(message: string): boolean {
    return [
      'ok',
      'oka',
      'okey',
      'si',
      'sí',
      'dale',
      'perfecto',
      'listo',
      'gracias',
      'precio',
      'tienes',
      'hay',
    ].includes(message);
  }

  private isGreetingMessage(message: string): boolean {
    return ['hola', 'hola!', 'buenas', 'buenos dias', 'buenos dias!', 'buenas tardes', 'buenas noches'].includes(message);
  }

  private shouldMarkConversationAsEnded(message: string): boolean {
    const normalized = this.normalizeTextForMatch(message);
    if (!normalized || this.shouldResumeClosedConversation(message)) {
      return false;
    }

    return [
      'te aviso',
      'yo te aviso',
      'manana sera',
      'luego',
      'despues hablamos',
      'mas tarde',
      'lo dejamos asi',
      'dejalo asi',
      'ok gracias',
      'gracias',
      'esta bien',
      'todo bien',
      'perfecto gracias',
      'listo gracias',
    ].some((keyword) => normalized.includes(keyword));
  }

  private shouldResumeClosedConversation(message: string): boolean {
    const normalized = this.normalizeTextForMatch(message);
    if (!normalized) {
      return false;
    }

    const intent = this.detectIntent(message);
    if (intent === 'interes' || intent === 'compra' || intent === 'catalogo' || intent === 'hot') {
      return true;
    }

    return [
      'precio',
      'cuanto',
      'vale',
      'quiero',
      'me interesa',
      'como compro',
      'como pido',
      'comprar',
      'pedido',
      'ordenar',
      'catalogo',
      'catalog',
      'mandame',
      'enviame',
      'enviamelo',
      'foto',
      'video',
      'ubicacion',
      'direccion',
      'pago',
      'cuenta',
      'disponible',
    ].some((keyword) => normalized.includes(keyword));
  }

  private buildConversationEndedReply(
    conversationMemory: ConversationMemoryState,
    closureDetected: boolean,
  ): string {
    const options = closureDetected
      ? [
          'Perfecto, lo dejamos hasta ahi por ahora. Cuando quieras retomarlo, me escribes.',
          'Dale, lo dejamos asi por ahora. Aqui sigo cuando quieras retomarlo.',
          'Todo bien, lo dejamos por ahora. Aqui estare cuando quieras volver a eso.',
        ]
      : [
          'Claro, aqui sigo cuando quieras retomarlo.',
          'Todo bien, lo dejamos por ahora.',
          'Perfecto, aqui estare cuando quieras volver a eso.',
        ];

    return this.pickFirstUnsentMessage(options, conversationMemory.sentMessages);
  }

  private buildConversationEndedDecision(message: string): BotDecisionState {
    const normalized = this.normalizeTextForMatch(message);

    return {
      intent: 'no_interesado',
      classificationSource: 'rules',
      stage: 'curioso',
      action: 'cerrar',
      purchaseIntentScore: 0,
      currentIntent: 'conversation_end',
      summaryText: 'Client ended the conversation for now.',
      keyFacts: {
        conversationEnded: true,
      },
      lastMessageId: `conversation_end:${this.hashValue(normalized || 'empty')}`,
    };
  }

  private isLongOrDetailedReply(reply: string): boolean {
    const normalized = reply.trim();
    if (!normalized) {
      return false;
    }

    if (normalized.length >= BotService.LONG_REPLY_MIN_CHARS) {
      return true;
    }

    const sentenceCount = normalized
      .split(/[.!?]+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0)
      .length;

    return sentenceCount >= 3;
  }

  private shouldAttachMediaToAiReply(
    message: string,
    intent: BotIntent,
    mediaIntent: MediaIntent,
    action: BotDecisionAction,
    hasProductCatalog: boolean,
    hasRelevantProducts: boolean,
  ): boolean {
    if (mediaIntent !== null) {
      return true;
    }

    if (!hasProductCatalog) {
      return intent === 'catalogo' || this.isVisualRequest(message);
    }

    if (hasRelevantProducts && (intent === 'interes' || this.requiresDetailedResponse(message))) {
      return true;
    }

    return (
      intent === 'catalogo' ||
      this.isVisualRequest(message) ||
      action === 'cerrar' ||
      action === 'responder_precio_con_valor' ||
      action === 'persuadir'
    );
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

  private resolveResponseStyleFromDecision(
    decision: BotDecisionState,
    message: string,
    intent: BotIntent,
  ): AssistantResponseStyle {
    if (decision.action === 'responder_precio_con_valor') {
      return 'brief';
    }

    if (decision.action === 'persuadir' || decision.action === 'hacer_seguimiento') {
      return 'balanced';
    }

    if (decision.intent === 'info') {
      return 'detailed';
    }

    return this.resolveResponseStyle(message, intent);
  }

  private mapDecisionStageToLeadStage(
    stage: ContactStage,
    hotLead: boolean,
  ): AssistantLeadStage {
    if (stage === 'listo' || hotLead) {
      return 'listo_para_comprar';
    }

    if (stage === 'dudoso') {
      return 'dudoso';
    }

    if (stage === 'interesado') {
      return 'interesado';
    }

    return 'curioso';
  }

  private mapDecisionActionToReplyObjective(
    action: BotDecisionAction,
  ): AssistantReplyObjective {
    if (action === 'cerrar') {
      return 'cerrar_venta';
    }

    if (action === 'persuadir') {
      return 'resolver_duda';
    }

    if (action === 'hacer_seguimiento') {
      return 'generar_confianza';
    }

    return 'avanzar_conversacion';
  }

  private mapDecisionIntentToBotIntent(
    intent: BotDecisionIntent,
    message: string,
  ): BotIntent {
    if (['catalogo', 'catálogo', 'catalog'].some((keyword) => message.toLowerCase().includes(keyword))) {
      return 'catalogo';
    }

    if (intent === 'compra') {
      return this.detectHotLead(message) ? 'hot' : 'compra';
    }

    if (intent === 'duda') {
      return 'duda';
    }

    if (intent === 'precio' || intent === 'info' || intent === 'interesado') {
      return 'interes';
    }

    return this.detectIntent(message);
  }

  private async runDecisionEngine(params: {
    contactId: string;
    message: string;
    history: StoredMessage[];
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>;
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>;
  }): Promise<BotDecisionState> {
    const normalizedMessage = params.message.trim();
    const cachedState = await this.readRedisCache<RedisStateSnapshot>(
      this.getStateCacheKey(params.contactId),
    );
    const currentState = cachedState ?? await this.prisma.contactState.findUnique({
      where: { contactId: params.contactId },
    });
    const cachedIntent = await this.readRedisCache<IntentCacheEntry>(
      this.getIntentCacheKey(params.contactId),
    );
    const intentResult = cachedIntent && this.areMessagesSimilar(cachedIntent.message, normalizedMessage)
      ? {
          intent: cachedIntent.intent,
          source: cachedIntent.source,
        }
      : await this.classifyIntent(
          normalizedMessage,
          params.history,
          params.config,
        );

    if (!cachedIntent || !this.areMessagesSimilar(cachedIntent.message, normalizedMessage)) {
      await this.redisService.set(
        this.getIntentCacheKey(params.contactId),
        {
          message: normalizedMessage,
          intent: intentResult.intent,
          source: intentResult.source,
          updatedAt: Date.now(),
        } satisfies IntentCacheEntry,
        BotService.INTENT_CACHE_TTL_SECONDS,
      );
    }
    const purchaseIntentScore = this.calculatePurchaseIntentScore(
      currentState?.purchaseIntentScore ?? 0,
      normalizedMessage,
      intentResult.intent,
    );
    const stage = this.updateStage(
      normalizedMessage,
      intentResult.intent,
      purchaseIntentScore,
      params.history,
      params.memoryContext,
      currentState?.stage ?? null,
    );
    const action = this.decideAction(intentResult.intent, stage);
    const lastMessageId = this.buildSyntheticMessageId(params.contactId, normalizedMessage);
    const summaryText = this.buildDecisionSummaryText(
      params.memoryContext,
      normalizedMessage,
      intentResult.intent,
      stage,
    );
    const keyFacts = this.buildDecisionKeyFacts(
      params.memoryContext,
      intentResult.intent,
      stage,
      purchaseIntentScore,
      action,
    );

    await this.prisma.contactState.upsert({
      where: { contactId: params.contactId },
      create: {
        contactId: params.contactId,
        name: params.memoryContext.clientMemory.name,
        currentIntent: intentResult.intent,
        stage,
        lastInteractionAt: new Date(),
        purchaseIntentScore,
        notesJson: keyFacts as Prisma.InputJsonValue,
      },
      update: {
        name: params.memoryContext.clientMemory.name,
        currentIntent: intentResult.intent,
        stage,
        lastInteractionAt: new Date(),
        purchaseIntentScore,
        notesJson: keyFacts as Prisma.InputJsonValue,
      },
    });

    await this.prisma.contactConversationSummary.upsert({
      where: { contactId: params.contactId },
      create: {
        contactId: params.contactId,
        summaryText,
        keyFactsJson: keyFacts as Prisma.InputJsonValue,
        lastMessageId,
      },
      update: {
        summaryText,
        keyFactsJson: keyFacts as Prisma.InputJsonValue,
        lastMessageId,
      },
    });

    await this.redisService.set(
      this.getStateCacheKey(params.contactId),
      {
        stage,
        currentIntent: intentResult.intent,
        purchaseIntentScore,
        updatedAt: Date.now(),
      } satisfies RedisStateSnapshot,
      BotService.STATE_CACHE_TTL_SECONDS,
    );

    return {
      intent: intentResult.intent,
      classificationSource: intentResult.source,
      stage,
      action,
      purchaseIntentScore,
      currentIntent: intentResult.intent,
      summaryText,
      keyFacts,
      lastMessageId,
    };
  }

  private async markBotResponseInDecisionState(
    contactId: string,
    reply: string,
    decision: BotDecisionState,
    mediaFiles: MediaFile[],
  ): Promise<void> {
    const now = new Date();
    const existingState = await this.prisma.contactState.findUnique({
      where: { contactId },
    });
    const existingNotes = this.asRecord(existingState?.notesJson);
    const sentMediaUrls = Array.from(
      new Set([
        ...this.asStringList(existingNotes.sentMediaUrls),
        ...mediaFiles.map((file) => file.fileUrl).filter((url) => url.trim().length > 0),
      ]),
    ).slice(-12);

    await this.redisService.set(
      `${BotService.SENT_MEDIA_CACHE_KEY_PREFIX}${contactId}`,
      sentMediaUrls,
    );

    await this.prisma.contactState.updateMany({
      where: { contactId },
      data: {
        lastBotMessageAt: now,
        notesJson: {
          ...(decision.keyFacts as Record<string, unknown>),
          lastBotReply: reply,
          lastAction: decision.action,
          sentMediaUrls,
        },
      },
    });
  }

  private async classifyIntent(
    message: string,
    history: StoredMessage[],
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
  ): Promise<{ intent: BotDecisionIntent; source: BotDecisionState['classificationSource'] }> {
    const normalized = message.trim().toLowerCase();

    if (!normalized) {
      return { intent: 'otro', source: 'heuristic_fallback' };
    }

    if (['precio', 'cuánto', 'cuanto', 'vale'].some((keyword) => normalized.includes(keyword))) {
      return { intent: 'precio', source: 'rules' };
    }

    if (this.requiresDetailedResponse(message)) {
      return { intent: 'info', source: 'rules' };
    }

    if (['cómo compro', 'como compro', 'pago', 'cuenta', 'envio', 'envío'].some((keyword) => normalized.includes(keyword))) {
      return { intent: 'compra', source: 'rules' };
    }

    if (['funciona', 'sirve', 'es verdad'].some((keyword) => normalized.includes(keyword))) {
      return { intent: 'duda', source: 'rules' };
    }

    if (['info', 'qué es', 'que es'].some((keyword) => normalized.includes(keyword))) {
      return { intent: 'info', source: 'rules' };
    }

    if (['no quiero', 'no me interesa', 'ya no'].some((keyword) => normalized.includes(keyword))) {
      return { intent: 'no_interesado', source: 'rules' };
    }

    const aiIntent = await this.aiService.classifyIntent({
      config,
      message,
      history,
    });

    if (aiIntent !== 'curioso') {
      return { intent: aiIntent, source: 'ai_fallback' };
    }

    if (this.hasComparisonSignal(message)) {
      return { intent: 'interesado', source: 'heuristic_fallback' };
    }

    if (this.hasSkepticalSignal(message)) {
      return { intent: 'duda', source: 'heuristic_fallback' };
    }

    if (this.detectHotLead(message)) {
      return { intent: 'compra', source: 'heuristic_fallback' };
    }

    if (this.requiresDetailedResponse(message)) {
      return { intent: 'info', source: 'heuristic_fallback' };
    }

    return { intent: 'curioso', source: 'heuristic_fallback' };
  }

  private updateStage(
    message: string,
    intent: BotDecisionIntent,
    purchaseIntentScore: number,
    history: StoredMessage[],
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
    currentStage: string | null,
  ): ContactStage {
    if (currentStage === 'cliente' || memoryContext.clientMemory.status === 'cliente') {
      return 'cliente';
    }

    if (
      intent === 'compra' ||
      this.detectHotLead(message) ||
      (history.length === 0 && this.isCloseSignal(message)) ||
      purchaseIntentScore >= 80
    ) {
      return 'listo';
    }

    if (intent === 'duda' || this.hasSkepticalSignal(message)) {
      return 'dudoso';
    }

    if (this.isDryAcknowledgement(message, history) || this.isVeryShortCustomerReply(message)) {
      return 'curioso';
    }

    if (
      intent === 'precio' ||
      intent === 'info' ||
      intent === 'interesado' ||
      this.hasComparisonSignal(message) ||
      purchaseIntentScore >= 20
    ) {
      return 'interesado';
    }

    return 'curioso';
  }

  private decideAction(intent: BotDecisionIntent, stage: ContactStage): BotDecisionAction {
    if (stage === 'cliente') {
      return 'hacer_seguimiento';
    }

    if (stage === 'listo') {
      return 'cerrar';
    }

    if (intent === 'precio') {
      return 'responder_precio_con_valor';
    }

    if (intent === 'duda') {
      return 'persuadir';
    }

    if (intent === 'no_interesado') {
      return 'hacer_seguimiento';
    }

    return 'guiar';
  }

  private calculatePurchaseIntentScore(
    currentScore: number,
    message: string,
    intent: BotDecisionIntent,
  ): number {
    const normalized = message.trim().toLowerCase();
    let nextScore = currentScore;

    if (intent === 'precio' || ['precio', 'cuánto', 'cuanto', 'vale'].some((keyword) => normalized.includes(keyword))) {
      nextScore += 20;
    }

    if (intent === 'compra' || ['cómo compro', 'como compro', 'pago', 'cuenta'].some((keyword) => normalized.includes(keyword))) {
      nextScore += 30;
    }

    if (['envio', 'envío', 'delivery'].some((keyword) => normalized.includes(keyword))) {
      nextScore += 40;
    }

    if (/(^|\s)no($|\s)|no quiero|no me interesa/.test(normalized)) {
      nextScore -= 20;
    }

    return Math.max(0, Math.min(100, nextScore));
  }

  private buildDecisionSummaryText(
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
    message: string,
    intent: BotDecisionIntent,
    stage: ContactStage,
  ): string {
    if (memoryContext.summary.summary?.trim()) {
      return memoryContext.summary.summary.trim();
    }

    const lines = memoryContext.messages
      .slice(-4)
      .map((item) => `${item.role}: ${item.content}`)
      .join(' | ');

    return [
      `Etapa: ${stage}`,
      `Intencion: ${intent}`,
      `Ultimo mensaje: ${message}`,
      lines ? `Historial reciente: ${lines}` : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join('\n');
  }

  private buildDecisionKeyFacts(
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
    intent: BotDecisionIntent,
    stage: ContactStage,
    purchaseIntentScore: number,
    action: BotDecisionAction,
  ): Record<string, unknown> {
    return {
      name: memoryContext.clientMemory.name,
      objective: memoryContext.clientMemory.objective,
      interest: memoryContext.clientMemory.interest,
      objections: memoryContext.clientMemory.objections,
      lastIntent: memoryContext.clientMemory.lastIntent,
      stage,
      currentIntent: intent,
      purchaseIntentScore,
      action,
      summary: memoryContext.summary.summary,
    };
  }

  private buildSyntheticMessageId(contactId: string, message: string): string {
    const compact = message.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24);
    return `${contactId}:${Date.now()}:${compact}`;
  }

  private isVeryShortCustomerReply(message: string): boolean {
    const words = message.trim().split(/\s+/).filter((word) => word.length > 0);
    return words.length > 0 && words.length <= 2 && message.trim().length <= 12;
  }

  private isCloseSignal(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return ['ok', 'perfecto', 'dale', 'esta bien', 'está bien'].includes(normalized);
  }

  private resolveLeadStage(
    message: string,
    intent: BotIntent,
    hotLead: boolean,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): AssistantLeadStage {
    if (this.hasComparisonSignal(message)) {
      return 'interesado';
    }

    if (this.hasSkepticalSignal(message)) {
      return 'dudoso';
    }

    if (this.isDryAcknowledgement(message, history)) {
      return 'curioso';
    }

    if (this.requiresDetailedResponse(message)) {
      return 'curioso';
    }

    if (hotLead || intent === 'hot' || intent === 'compra' || intent === 'cierre') {
      return 'listo_para_comprar';
    }

    if (intent === 'duda') {
      return 'dudoso';
    }

    if (intent === 'interes') {
      return 'interesado';
    }

    return 'curioso';
  }

  private resolveReplyObjective(
    message: string,
    intent: BotIntent,
    hotLead: boolean,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): AssistantReplyObjective {
    if (this.hasComparisonSignal(message)) {
      return 'generar_confianza';
    }

    if (this.hasSkepticalSignal(message)) {
      return 'resolver_duda';
    }

    if (this.isDryAcknowledgement(message, history)) {
      return 'generar_confianza';
    }

    if (this.requiresDetailedResponse(message)) {
      return 'generar_confianza';
    }

    if (hotLead || intent === 'hot' || intent === 'compra' || intent === 'cierre') {
      return 'cerrar_venta';
    }

    if (intent === 'duda') {
      return 'resolver_duda';
    }

    return 'avanzar_conversacion';
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

  private hasSkepticalSignal(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'funciona de verdad',
      'eso funciona',
      'seguro',
      'me da miedo',
      'no quiero botar mi dinero',
      'y si no me funciona',
      'es verdad',
      'sirve de verdad',
    ].some((keyword) => normalized.includes(keyword));
  }

  private hasComparisonSignal(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'mejor que',
      'más que la otra',
      'mas que la otra',
      'igual que la otra',
      'como la otra',
      'que la otra',
      'vs',
      'versus',
      'compar',
      'otra que venden',
      'otro producto',
      'otra pastilla',
    ].some((keyword) => normalized.includes(keyword));
  }

  private isDryAcknowledgement(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized || history.length === 0 || this.detectHotLead(normalized)) {
      return false;
    }

    return [
      'ok',
      'oka',
      'okey',
      'okeys',
      'dale',
      'aja',
      'ajá',
      'mmm',
      'mm',
      'hmm',
      'si',
      'sí',
      'ta bien',
      'está bien',
      'esta bien',
    ].includes(normalized);
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
        memoryContext.clientMemory.objective ||
        memoryContext.clientMemory.interest ||
        (memoryContext.clientMemory.objections?.length ?? 0) > 0 ||
        memoryContext.clientMemory.status !== 'nuevo',
    );
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
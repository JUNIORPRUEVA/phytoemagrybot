import { Prisma } from '@prisma/client';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import {
  AssistantLeadStage,
  AssistantReplyObjective,
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

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

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
    const preferredReplyType = this.resolvePreferredReplyType(normalizedMessage);
    const responseStyle = this.resolveResponseStyleFromDecision(decision, normalizedMessage, intent);
    const leadStage = this.mapDecisionStageToLeadStage(decision.stage, hotLead);
    const replyObjective = this.mapDecisionActionToReplyObjective(decision.action);
    const usedMemory = this.hasUsefulMemory(memoryContext, history.length);
    const cacheKey = this.getReplyCacheKey(normalizedContactId, normalizedMessage);
    const cachedReply = await this.redisService.get<BotReplyResult>(cacheKey);
    const galleryMediaFiles = await this.selectMedia(normalizedMessage, intent);

    if (cachedReply) {
      const result: BotReplyResult = {
        ...cachedReply,
        intent,
        decisionIntent: decision.intent,
        stage: decision.stage,
        action: decision.action,
        purchaseIntentScore: decision.purchaseIntentScore,
        hotLead,
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
      mediaFiles: galleryMediaFiles,
      preferredReplyType,
      responseStyle,
      decision,
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

    const companyContext = await this.companyContextService.buildAgentContextForMessage(
      normalizedMessage,
    );

    const reply = await this.aiService.generateReply({
      config,
      fullPrompt: this.botConfigService.getFullPrompt(botConfig),
      companyContext,
      contactId: normalizedContactId,
      message: normalizedMessage,
      history,
      context: this.buildConversationContext(memoryContext),
      classifiedIntent: decision.intent,
      decisionAction: decision.action,
      purchaseIntentScore: decision.purchaseIntentScore,
      responseStyle,
      leadStage,
      replyObjective,
    });

    const mediaFiles = this.shouldAttachMediaToAiReply(normalizedMessage, intent)
      ? galleryMediaFiles
      : [];

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
      decisionIntent: decision.intent,
      stage: decision.stage,
      action: decision.action,
      purchaseIntentScore: decision.purchaseIntentScore,
      hotLead,
      cached: false,
      usedGallery: mediaFiles.length > 0,
      usedMemory,
      source: 'ai',
    };

    await this.markBotResponseInDecisionState(normalizedContactId, reply.content, decision);
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
      cached: false,
      usedGallery: mediaFiles.length > 0,
      usedMemory,
      source,
    };
  }

  private resolvePreferredReplyType(message: string): BotReplyResult['replyType'] {
    return this.prefersVoiceReply(message) ? 'audio' : 'text';
  }

  private shouldAttachMediaToAiReply(message: string, intent: BotIntent): boolean {
    return intent === 'catalogo' || this.isVisualRequest(message);
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
    const currentState = await this.prisma.contactState.findUnique({
      where: { contactId: params.contactId },
    });
    const intentResult = await this.classifyIntent(
      normalizedMessage,
      params.history,
      params.config,
    );
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
  ): Promise<void> {
    const now = new Date();
    await this.prisma.contactState.updateMany({
      where: { contactId },
      data: {
        lastBotMessageAt: now,
        notesJson: {
          ...(decision.keyFacts as Record<string, unknown>),
          lastBotReply: reply,
          lastAction: decision.action,
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
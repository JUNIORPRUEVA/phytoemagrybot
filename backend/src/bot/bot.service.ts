import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { BotConfigService } from '../bot-config/bot-config.service';
import { ClientConfigService } from '../config/config.service';
import { MemoryService } from '../memory/memory.service';
import { StoredMessage } from '../memory/memory.types';
import { BotDecisionAction, BotDecisionIntent, ContactStage } from './bot-decision.types';
import { BotIntent, BotReplyResult, BotTestReport, BotTestStepResult } from './bot.types';
import { ToolsService } from '../tools/tools.service';
import { ToolsExecutor } from '../tools/tools.executor';
import { PromptComposerService } from './prompt-composer.service';
import OpenAI from 'openai';

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

type ContinuationPolarity = 'affirmative' | 'negative' | 'ambiguous' | null;

interface ContinuationContext {
  isContinuation: boolean;
  polarity: ContinuationPolarity;
  lastAssistant: string | null;
  inferredIntent: BotIntent | null;
  inferredAction: BotDecisionAction | null;
  topic: 'product' | 'catalog' | 'price' | 'purchase' | 'company' | 'general' | null;
}

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  private static readonly COMPANY_TOOL_NAME = 'consultar_info_empresa';
  private static readonly RETURNING_CUSTOMER_GAP_MS = 3 * 60 * 60 * 1000;

  constructor(
    private readonly aiService: AiService,
    private readonly botConfigService: BotConfigService,
    private readonly clientConfigService: ClientConfigService,
    private readonly memoryService: MemoryService,
    private readonly toolsService: ToolsService,
    private readonly toolsExecutor: ToolsExecutor,
    private readonly promptComposerService: PromptComposerService,
  ) {}

  async processIncomingMessage(
    contactId: string,
    message: string,
    companyId?: string,
    metadata?: {
      messageType?: 'text' | 'audio' | 'image';
      transcript?: string | null;
    },
  ): Promise<BotReplyResult> {
    const normalizedContactId = contactId.trim();
    const normalizedMessage = message.trim();

    if (!normalizedContactId) throw new BadRequestException('contactId is required');
    if (!/^\+?[0-9A-Za-z._:-]{3,120}$/.test(normalizedContactId)) {
      throw new BadRequestException('contactId is invalid');
    }
    if (!normalizedMessage) throw new BadRequestException('message is required');

    this.logger.log(
      JSON.stringify({ event: 'bot_message_received', contactId: normalizedContactId }),
    );

    const effectiveCompanyId = companyId ?? '';

    const config = await this.clientConfigService.getConfig(effectiveCompanyId);
    const botConfig = await this.botConfigService.getConfig(effectiveCompanyId);

    await this.memoryService.saveMessage({
      contactId: normalizedContactId,
      role: 'user',
      content: normalizedMessage,
      companyId: effectiveCompanyId,
    });

    const memoryWindow = config.aiSettings?.memoryWindow ?? 6;
    const memoryContext = await this.memoryService.getConversationContext(
      effectiveCompanyId,
      normalizedContactId,
      memoryWindow,
    );
    const history: StoredMessage[] = memoryContext.messages.filter(
      (m) => !(m.role === 'user' && m.content === normalizedMessage),
    );
    const previousInteractionAt = this.getPreviousInteractionAt(
      history,
      memoryContext.summary.updatedAt,
      memoryContext.clientMemory.updatedAt,
    );

    const lastAssistantFromHistory = [...history].reverse().find((m) => m.role === 'assistant');
    const isShortReply = this.isShortContinuation(this.normalizeForIntent(normalizedMessage));
    const lastAssistantMessage = lastAssistantFromHistory ?? (isShortReply
      ? await this.memoryService.getLastAssistantMessage(effectiveCompanyId, normalizedContactId)
      : null);
    const continuation = this.buildContinuationContext(
      normalizedMessage,
      lastAssistantMessage?.content,
      memoryContext.clientMemory.lastIntent,
    );
    const effectiveMessage = this.buildEffectiveUserMessage(normalizedMessage, continuation);

    let systemPrompt = await this.buildKnowledgeContext(
      config,
      botConfig,
      memoryContext.clientMemory,
      memoryContext.summary,
      previousInteractionAt,
    );

    this.logger.log(
      JSON.stringify({
        event: 'bot_memory_context',
        contactId: normalizedContactId,
        historyMessages: history.length,
        hasClientMemory: !!memoryContext.clientMemory.status || !!memoryContext.clientMemory.name,
        hasSummary: !!memoryContext.summary.summary,
        clientStatus: memoryContext.clientMemory.status,
        clientName: memoryContext.clientMemory.name,
        rawMemoryMessages: memoryContext.messages.length,
        lastAssistantFound: !!lastAssistantMessage?.content,
        lastAssistantSource: lastAssistantFromHistory ? 'history' : lastAssistantMessage ? 'fallback' : null,
        continuationDetected: continuation.isContinuation,
        continuationPolarity: continuation.polarity,
        continuationTopic: continuation.topic,
        inferredIntent: continuation.inferredIntent,
      }),
    );

    const rawToolsConfig = this.asRecord(
      this.asRecord(config.configurations).tools,
    );
    const toolsConfig = this.toolsService.resolveConfig(rawToolsConfig);
    let openAiTools = this.toolsService.buildOpenAITools(toolsConfig);

    const companyToolNeed = this.detectCompanyInfoToolNeed(effectiveMessage);
    let toolChoice: OpenAI.ChatCompletionToolChoiceOption | undefined;
    if (companyToolNeed && openAiTools.length > 0) {
      const hasCompanyTool = this.hasTool(openAiTools, BotService.COMPANY_TOOL_NAME);
      if (!hasCompanyTool) {
        openAiTools = [...openAiTools, this.buildConsultarInfoEmpresaToolSpec()];
      }

      toolChoice = {
        type: 'function',
        function: { name: BotService.COMPANY_TOOL_NAME },
      };

      systemPrompt = [
        systemPrompt,
        '[EMPRESA_TOOL_HINT]',
        `Para responder este mensaje, primero llama ${BotService.COMPANY_TOOL_NAME} con campo="${companyToolNeed.campo}".`,
      ].join('\n\n');
    }

    const hasTools = openAiTools.length > 0;

    const aiReply = hasTools
      ? await this.aiService.generateReplyWithTools({
          openaiKey: config.openaiKey,
          modelName: config.aiSettings?.modelName,
          temperature: config.aiSettings?.temperature,
          maxTokens: config.aiSettings?.maxCompletionTokens,
          systemPrompt,
          history,
          message: effectiveMessage,
          tools: openAiTools,
          toolChoice,
          executeToolCall: (toolName, args) =>
            this.toolsExecutor.execute(toolName, args, normalizedContactId, toolsConfig, effectiveCompanyId),
        })
      : await this.aiService.generateSimpleReply({
          openaiKey: config.openaiKey,
          modelName: config.aiSettings?.modelName,
          temperature: config.aiSettings?.temperature,
          maxTokens: config.aiSettings?.maxCompletionTokens,
          systemPrompt,
          history,
          message: effectiveMessage,
        });

    const toolGroundedReply = this.repairToolGroundedReply(
      normalizedMessage,
      aiReply.content.trim(),
      aiReply.toolResults ?? [],
    );
    const finalReply = this.repairContinuationReply(
      normalizedMessage,
      toolGroundedReply,
      continuation,
    );

    await this.memoryService.saveMessage({
      contactId: normalizedContactId,
      role: 'assistant',
      content: finalReply,
      companyId: effectiveCompanyId,
    });

    const hotLead = this.detectHotLead(normalizedMessage) || continuation.inferredIntent === 'compra';
    const intent = this.resolveIntentWithContinuation(
      normalizedMessage,
      this.detectIntent(normalizedMessage),
      continuation,
    );
    const usedMemory = history.length > 0;
    const replyType = metadata?.messageType === 'audio' ? 'audio' : 'text';

    const result: BotReplyResult = {
      reply: finalReply,
      replyType,
      mediaFiles: [],
      intent,
      decisionIntent: this.intentToBotDecisionIntent(intent),
      stage: 'curioso' as ContactStage,
      action: (continuation.inferredAction ?? (hotLead ? 'cerrar' : 'guiar')) as BotDecisionAction,
      purchaseIntentScore: hotLead ? 80 : continuation.isContinuation ? 35 : 15,
      hotLead,
      cached: false,
      usedGallery: false,
      usedMemory,
      source: 'ai',
    };

    this.logger.log(
      JSON.stringify({
        event: 'bot_reply_sent',
        contactId: normalizedContactId,
        replyType,
        hotLead,
        source: 'ai',
        toolsUsed: aiReply.toolsUsed ?? [],
        continuationDetected: continuation.isContinuation,
        continuationPolarity: continuation.polarity,
        lastAssistantFound: !!continuation.lastAssistant,
        inferredIntent: continuation.inferredIntent,
      }),
    );

    return result;
  }

  async runBotTests(): Promise<BotTestReport> {
    const startedAt = Date.now();
    const baseId = `__bot_test__${startedAt}`;
    const scenarios: Array<{ scenario: string; contactId: string; messages: string[] }> = [
      { scenario: 'info_simple', contactId: `${baseId}-info`, messages: ['precio'] },
      { scenario: 'compra', contactId: `${baseId}-buy`, messages: ['lo quiero'] },
      { scenario: 'duda', contactId: `${baseId}-doubt`, messages: ['funciona de verdad?'] },
    ];

    const results: BotTestStepResult[] = [];

    for (const scenario of scenarios) {
      try {
        let result: BotReplyResult | undefined;
        for (const msg of scenario.messages) {
          result = await this.processIncomingMessage(scenario.contactId, msg);
        }
        if (!result) throw new Error('No result');
        results.push({
          scenario: scenario.scenario,
          contactId: scenario.contactId,
          messages: scenario.messages,
          passed: result.source === 'ai' && result.reply.length > 0,
          checks: {
            shortReply: result.reply.length > 0,
            usedGallery: false,
            detectedHotLead: result.hotLead,
            salesClose: result.reply.length > 0,
          },
          result,
        });
      } catch (error) {
        results.push({
          scenario: scenario.scenario,
          contactId: scenario.contactId,
          messages: scenario.messages,
          passed: false,
          checks: { shortReply: false, usedGallery: false, detectedHotLead: false, salesClose: false },
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { ok: results.every((r) => r.passed), durationMs: Date.now() - startedAt, results };
  }

  detectHotLead(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return [
      'lo quiero',
      'dame uno',
      'como compro',
      'cómo compro',
      'lo compro',
      'quiero comprar',
      'te voy a comprar',
    ].some((keyword) => normalized.includes(keyword));
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async buildKnowledgeContext(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
    botConfig: Awaited<ReturnType<BotConfigService['getConfig']>>,
    clientMemory?: import('../memory/memory.types').ClientMemorySnapshot,
    conversationSummary?: import('../memory/memory.types').ConversationSummarySnapshot,
    previousInteractionAt?: Date | null,
  ): Promise<string> {
    const instructions = this.promptComposerService.buildInstructionsBlock(config, botConfig);
    const products = [
      'El catálogo de productos vive en la base de datos y se consulta por tools.',
      'Para responder con datos exactos:',
      '- Si el cliente pregunta productos, catálogo, precio, disponibilidad, stock o total, DEBES usar la tool aplicable antes de responder.',
      '- Usa consultar_catalogo cuando el cliente pregunte qué vendes o pida lista de productos.',
      '- Usa consultar_stock cuando el cliente pregunte por disponibilidad/stock.',
      '- Usa generar_cotizacion cuando el cliente quiera el total (incluye envío).',
      '- Si un producto tiene variantes/opciones (tipo, talla, color, modelo, presentación), pregunta cuál variante desea antes de cerrar precio total o pedido.',
      'No inventes productos, precios o stock si no consultaste las tools.',
    ].join('\n');
    const company = [
      'La información real de la empresa vive en la base de datos y se consulta por tools.',
      'Para responder con datos exactos:',
      '- Si el cliente pregunta ubicación, horario, cuentas, teléfonos, contacto o fotos, DEBES usar consultar_info_empresa antes de responder.',
      '- Usa consultar_info_empresa cuando el cliente pregunte por ubicación, horario, cuentas de pago, teléfonos o fotos.',
      'No inventes dirección, GPS, horarios, cuentas ni teléfonos si no consultaste la tool.',
    ].join('\n');
    const memory = this.buildMemoryBlock(
      clientMemory,
      conversationSummary,
      previousInteractionAt,
    );

    const blocks: string[] = [
      '[INSTRUCCIONES]',
      instructions || 'Sin instrucciones configuradas.',
      '[PRODUCTOS]',
      products,
      '[EMPRESA]',
      company,
    ];

    if (memory) {
      blocks.push('[MEMORIA DEL CLIENTE]', memory);
    }

    return blocks.join('\n\n');
  }

  private buildMemoryBlock(
    clientMemory?: import('../memory/memory.types').ClientMemorySnapshot,
    conversationSummary?: import('../memory/memory.types').ConversationSummarySnapshot,
    previousInteractionAt?: Date | null,
  ): string {
    const lines: string[] = [];

    if (clientMemory) {
      const statusLabels: Record<string, string> = {
        nuevo: 'Nuevo (aún no ha comprado)',
        interesado: 'Interesado (está evaluando)',
        cliente: 'Ya es cliente (ha comprado)',
      };
      if (clientMemory.name) lines.push(`Nombre del cliente: ${clientMemory.name}`);
      if (clientMemory.status) lines.push(`Estado: ${statusLabels[clientMemory.status] ?? clientMemory.status}`);
      if (clientMemory.objective) {
        const objLabels: Record<string, string> = {
          rebajar: 'Quiere bajar de peso',
          info: 'Busca información',
          comprar: 'Quiere comprar',
        };
        lines.push(`Objetivo: ${objLabels[clientMemory.objective] ?? clientMemory.objective}`);
      }
      if (clientMemory.interest) lines.push(`Interés principal: ${clientMemory.interest}`);
      if (clientMemory.lastIntent) lines.push(`Última intención detectada: ${clientMemory.lastIntent}`);
      if (clientMemory.objections.length > 0) {
        lines.push(`Objeciones que ha expresado: ${clientMemory.objections.join(', ')}`);
      }
      if (clientMemory.notes) lines.push(`Notas: ${clientMemory.notes}`);

      // Personal data — permanent profile fields
      const pd = clientMemory.personalData;
      if (pd.phone) lines.push(`Teléfono del cliente: ${pd.phone}`);
      if (pd.address) lines.push(`Dirección del cliente: ${pd.address}`);
      if (pd.location) lines.push(`Ubicación / zona: ${pd.location}`);
      if (pd.preferences && pd.preferences.length > 0) {
        lines.push(`Preferencias del cliente: ${pd.preferences.join(', ')}`);
      }
    }

    if (conversationSummary?.summary) {
      lines.push(`\nResumen de conversación previa:\n${conversationSummary.summary}`);
    }

    if (previousInteractionAt) {
      const elapsedMs = Date.now() - previousInteractionAt.getTime();
      if (elapsedMs >= BotService.RETURNING_CUSTOMER_GAP_MS) {
        const elapsedHours = Math.floor(elapsedMs / (60 * 60 * 1000));
        lines.push(
          `\nContexto de reencuentro: el cliente está retomando la conversación después de ${elapsedHours} hora${elapsedHours === 1 ? '' : 's'} o más. Si saludas, usa una reentrada breve y confiable como "hola de nuevo"; si el tema está claro, responde directo. No uses "en qué te puedo ayudar" ni variantes.`,
        );
      } else {
        lines.push(
          '\nContexto reciente: el cliente ya venía conversando hace poco. Continúa el hilo sin reiniciar ni usar frases como "en qué te puedo ayudar".',
        );
      }
    }

    return lines.join('\n');
  }

  private getPreviousInteractionAt(
    history: StoredMessage[],
    summaryUpdatedAt?: Date | null,
    clientMemoryUpdatedAt?: Date | null,
  ): Date | null {
    const timestamps = history
      .map((message) => message.createdAt ?? null)
      .filter((value): value is Date => value instanceof Date)
      .map((value) => value.getTime());

    if (summaryUpdatedAt instanceof Date) {
      timestamps.push(summaryUpdatedAt.getTime());
    }
    if (clientMemoryUpdatedAt instanceof Date) {
      timestamps.push(clientMemoryUpdatedAt.getTime());
    }

    if (timestamps.length === 0) {
      return null;
    }

    return new Date(Math.max(...timestamps));
  }

  private buildProductsBlock(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
  ): string {
    const products = this.getProductsFromConfig(config);
    return products.map((p) => this.formatProductBlock(p)).filter(Boolean).join('\n\n');
  }

  private getProductsFromConfig(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
  ): StructuredProduct[] {
    const configurations = this.asRecord(config.configurations);
    const instructions = this.asRecord(configurations.instructions);
    const rawProducts = Array.isArray(instructions.products) ? instructions.products : [];

    return rawProducts
      .map((v) => this.normalizeProduct(v))
      .filter((p): p is StructuredProduct => Boolean(p?.titulo && p.activo));
  }

  private formatProductBlock(product: StructuredProduct): string {
    const lines = [
      product.titulo,
      product.descripcionCorta ? '- Descripcion: ' + product.descripcionCorta : '',
      product.descripcionCompleta ? '- Detalle: ' + product.descripcionCompleta : '',
      product.precio != null ? '- Precio: ' + String(product.precio) : '',
      product.precioMinimo != null ? '- Precio minimo: ' + String(product.precioMinimo) : '',
      product.imagenes.length > 0 ? '- Imagenes: ' + product.imagenes.join(', ') : '',
      product.videos.length > 0 ? '- Videos: ' + product.videos.join(', ') : '',
    ].filter(Boolean);
    return lines.join('\n');
  }

  private normalizeProduct(value: unknown): StructuredProduct | null {
    const p = this.asRecord(value);
    const titulo = this.asString(p.titulo) || this.asString(p.title) || this.asString(p.name);
    if (!titulo) return null;

    return {
      id: this.asString(p.id) || titulo,
      titulo,
      descripcionCorta:
        this.asString(p.descripcionCorta) ||
        this.asString(p.descripcion_corta) ||
        this.asString(p.summary),
      descripcionCompleta:
        this.asString(p.descripcionCompleta) ||
        this.asString(p.descripcion_completa) ||
        this.asString(p.description),
      precio: typeof p.precio === 'number' ? p.precio : this.asString(p.precio) || null,
      precioMinimo:
        typeof p.precioMinimo === 'number'
          ? p.precioMinimo
          : this.asString(p.precioMinimo) || null,
      imagenes: this.asStringList(p.imagenes),
      videos: this.asStringList(p.videos),
      activo: p.activo !== false,
    };
  }

  private detectIntent(message: string): BotIntent {
    const normalized = this.normalizeForIntent(message);
    if (this.detectHotLead(message)) return 'compra';
    if (/precio|cuanto cuesta|cuanto vale|vale|catalogo|catalogo|producto|stock|disponible|ubicacion|direccion|donde|horario|cuenta|pago|telefono|contacto|cotizacion|total/.test(normalized)) return 'interes';
    if (/funciona|sirve|beneficio|resultado|verdad|como se usa|uso/.test(normalized)) return 'duda';
    return 'otro';
  }

  private buildContinuationContext(
    message: string,
    lastAssistant?: string,
    lastIntent?: string | null,
  ): ContinuationContext {
    const normalized = this.normalizeForIntent(message);
    const polarity = this.classifyShortContinuation(normalized);
    const assistant = lastAssistant?.trim() || null;
    if (!polarity || !assistant) {
      return {
        isContinuation: false,
        polarity,
        lastAssistant: assistant,
        inferredIntent: null,
        inferredAction: null,
        topic: null,
      };
    }

    const topic = this.inferContinuationTopic(assistant);
    const inferredIntent = this.inferContinuationIntent(polarity, topic, lastIntent);
    const inferredAction = this.inferContinuationAction(polarity, topic);

    return {
      isContinuation: true,
      polarity,
      lastAssistant: assistant,
      inferredIntent,
      inferredAction,
      topic,
    };
  }

  private buildEffectiveUserMessage(message: string, continuation: ContinuationContext): string {
    if (!continuation.isContinuation || !continuation.lastAssistant) {
      return message;
    }

    const polarityLabel =
      continuation.polarity === 'affirmative'
        ? 'afirmativamente'
        : continuation.polarity === 'negative'
          ? 'negativamente'
          : 'de forma corta/ambigua';

    return [
      message,
      '',
      '[CONTEXTO DE CONTINUIDAD]',
      `El usuario está respondiendo ${polarityLabel} al último mensaje del bot.`,
      `Último mensaje del bot: ${continuation.lastAssistant.slice(0, 500)}`,
      continuation.topic ? `Tema inferido: ${continuation.topic}.` : '',
      continuation.inferredIntent ? `Intención inferida: ${continuation.inferredIntent}.` : '',
      'Continúa exactamente desde ese ofrecimiento/pregunta; no saludes, no cambies de tema y no repitas la misma pregunta.',
      'Si el usuario aceptó una oferta, avanza al próximo paso lógico como una persona por WhatsApp.',
      'Si hace falta catálogo, precio, stock, cotización o variante, usa la tool correspondiente o pide solo el dato faltante.',
    ].join('\n');
  }

  private classifyShortContinuation(normalized: string): ContinuationPolarity {
    if (
      [
        'si',
        'sii',
        'sip',
        'claro',
        'dale',
        'ok',
        'okay',
        'ta bien',
        'esta bien',
        'aja',
        'ajá',
        'perfecto',
        'listo',
        'bueno',
      ].includes(normalized)
    ) {
      return 'affirmative';
    }

    if (
      [
        'no',
        'nop',
        'no gracias',
        'ahora no',
        'todavia no',
        'despues',
        'luego',
        'nah',
      ].includes(normalized)
    ) {
      return 'negative';
    }

    if (['como', 'y eso', 'explicame', 'dime', 'cual'].includes(normalized)) {
      return 'ambiguous';
    }

    return null;
  }

  private inferContinuationTopic(lastAssistant: string): ContinuationContext['topic'] {
    const normalized = this.normalizeForIntent(lastAssistant);
    if (/catalogo|productos|opciones|lista/.test(normalized)) return 'catalog';
    if (/precio|cuesta|vale|cotiz|total/.test(normalized)) return 'price';
    if (/compr|pedido|probarlo|quieres probar|te gustaria probar|lo quieres/.test(normalized)) return 'purchase';
    if (/producto|phytoemagry|capsula|suplemento|rebajar|perdida de peso/.test(normalized)) return 'product';
    if (/ubicacion|direccion|horario|telefono|cuenta|pago|tienda/.test(normalized)) return 'company';
    return 'general';
  }

  private inferContinuationIntent(
    polarity: ContinuationPolarity,
    topic: ContinuationContext['topic'],
    lastIntent?: string | null,
  ): BotIntent | null {
    if (polarity === 'negative') return 'otro';
    if (polarity !== 'affirmative' && polarity !== 'ambiguous') return null;
    if (topic === 'purchase') return 'compra';
    if (topic === 'catalog') return 'interes';
    if (topic === 'product') return 'interes';
    if (topic === 'price') return 'interes';
    if (topic === 'company') return 'interes';
    if (lastIntent === 'compra') return 'compra';
    if (lastIntent === 'interes' || lastIntent === 'interesado') return 'interes';
    if (lastIntent === 'duda') return 'duda';
    return 'interes';
  }

  private inferContinuationAction(
    polarity: ContinuationPolarity,
    topic: ContinuationContext['topic'],
  ): BotDecisionAction | null {
    if (polarity === 'negative') return 'guiar';
    if (polarity === 'affirmative' && topic === 'purchase') return 'cerrar';
    if (polarity === 'affirmative') return 'guiar';
    return null;
  }

  private resolveIntentWithContinuation(
    message: string,
    detectedIntent: BotIntent,
    continuation: ContinuationContext,
  ): BotIntent {
    if (continuation.isContinuation && continuation.inferredIntent) {
      return continuation.inferredIntent;
    }
    const normalized = this.normalizeForIntent(message);
    if (this.classifyShortContinuation(normalized) && detectedIntent === 'otro') {
      return continuation.inferredIntent ?? 'interes';
    }
    return detectedIntent;
  }

  private isShortContinuation(normalized: string): boolean {
    return this.classifyShortContinuation(normalized) !== null;
  }

  private repairContinuationReply(
    message: string,
    content: string,
    continuation: ContinuationContext,
  ): string {
    if (!continuation.isContinuation || !continuation.lastAssistant) return content;

    if (continuation.polarity === 'negative') {
      return this.isGenericOrRepeatedContinuationReply(content, continuation)
        ? 'Dale, sin problema. Cuando quieras retomarlo, me escribes con confianza.'
        : content;
    }

    if (continuation.polarity !== 'affirmative') return content;
    if (!this.isGenericOrRepeatedContinuationReply(content, continuation)) return content;

    if (continuation.topic === 'purchase') {
      return 'Perfecto, dale. Entonces seguimos con ese producto. Para orientarte bien con el próximo paso, ¿quieres que te cotice una unidad?';
    }

    if (continuation.topic === 'catalog') {
      return 'Perfecto. Te muestro las opciones disponibles y seguimos con la que más te interese.';
    }

    if (continuation.topic === 'product') {
      return 'Claro. Te explico breve: es una opción pensada para apoyar tu objetivo de rebajar dentro de una rutina constante. ¿Quieres que te pase precio y disponibilidad?';
    }

    if (continuation.topic === 'price') {
      return 'Dale. Para darte el total exacto, dime cuántas unidades quieres cotizar.';
    }

    return 'Claro, seguimos con eso. Te confirmo lo que necesites para avanzar.';
  }

  private isGenericOrRepeatedContinuationReply(
    content: string,
    continuation: ContinuationContext,
  ): boolean {
    const normalized = this.normalizeForIntent(content);
    if (/(en que|como) (te )?pued(o|a) (ayudar(te)?|servir(te)?|orientar(te)?)|hay algo mas|te gustaria saber mas|quieres saber mas/.test(normalized)) {
      return true;
    }

    if (!continuation.lastAssistant) return false;
    const last = this.normalizeForIntent(continuation.lastAssistant);
    const repeatedOffer = [
      'te gustaria probarlo',
      'quieres probarlo',
      'te gustaria saber mas',
      'quieres saber mas',
      'quieres que te muestre',
    ].some((phrase) => last.includes(phrase) && normalized.includes(phrase));

    return repeatedOffer;
  }

  private repairToolGroundedReply(
    message: string,
    content: string,
    toolResults: import('../tools/tools.types').ToolExecutionResult[],
  ): string {
    const normalized = this.normalizeForIntent(message);
    const askedLocation = /ubicacion|direc|direccion|donde|maps|mapa|gps|tienda|local|sucursal/.test(normalized);
    const askedSchedule = /horario|abren|abierto|cierran|cerrado|hasta que hora|a que hora/.test(normalized);
    const askedPayments = /cuenta|cuentas|banco|transfer|transferencia|deposit|deposito|pago|pagar|como pago|cómo pago/.test(normalized);
    const askedPhones = /telefono|tel|whatsapp|contacto|numero|n[úu]mero|llamar|escribir/.test(normalized);
    const askedPhotos = /foto|fotos|imagen|imagenes|logo/.test(normalized);

    if (!askedLocation && !askedSchedule && !askedPayments && !askedPhones && !askedPhotos) {
      return content;
    }

    const companyTool = toolResults.find((r) => r.toolName === BotService.COMPANY_TOOL_NAME);
    const result = this.asRecord(companyTool?.result);
    const normalizedContent = this.normalizeForIntent(content);
    const companyName = this.asString(result.companyName) || 'la empresa';

    const segments: string[] = [];

    if (askedLocation) {
      const address = this.asString(result.address);
      const maps = this.asString(result.googleMapsLink);
      const normalizedAddress = this.normalizeForIntent(address);

      const contentMentionsAddress =
        normalizedAddress &&
        normalizedContent.includes(
          normalizedAddress.slice(0, Math.min(20, normalizedAddress.length)),
        );

      if (address && !contentMentionsAddress) {
        segments.push(`${companyName} está ubicada en ${address}.`);
        if (maps) segments.push(`Mapa: ${maps}`);
      }
    }

    if (askedSchedule) {
      const workingHours = Array.isArray(result.workingHours)
        ? (result.workingHours as Array<Record<string, unknown>>)
        : [];

      const hasHoursInContent = /lunes|martes|miercoles|miercoles|jueves|viernes|sabado|sabado|domingo|\b\d{1,2}:\d{2}\b/.test(
        normalizedContent,
      );

      if (workingHours.length > 0 && !hasHoursInContent) {
        const lines = workingHours
          .map((item) => {
            const day = this.asString(item.day);
            const open = item.open === true;
            if (!day) return '';
            if (!open) return `- ${day}: cerrado`;
            const from = this.asString(item.from);
            const to = this.asString(item.to);
            if (from && to) return `- ${day}: ${from} - ${to}`;
            return `- ${day}: abierto`;
          })
          .filter(Boolean);

        if (lines.length > 0) {
          segments.push(['Horario:', ...lines].join('\n'));
        }
      }
    }

    if (askedPayments) {
      const accounts = Array.isArray(result.bankAccounts)
        ? (result.bankAccounts as Array<Record<string, unknown>>)
        : [];
      const hasAccountInContent = /ban|bhd|popular|cuenta|transfer|deposit/.test(normalizedContent);

      if (accounts.length > 0 && !hasAccountInContent) {
        const lines = accounts
          .slice(0, 3)
          .map((acc) => {
            const bank = this.asString(acc.bank);
            const accountType = this.asString(acc.accountType);
            const number = this.asString(acc.number);
            const holder = this.asString(acc.holder);
            const bits = [
              bank ? `Banco: ${bank}` : '',
              accountType ? `Tipo: ${accountType}` : '',
              number ? `Número: ${number}` : '',
              holder ? `Titular: ${holder}` : '',
            ].filter(Boolean);
            return bits.length ? `- ${bits.join(' | ')}` : '';
          })
          .filter(Boolean);

        if (lines.length > 0) {
          segments.push(['Cuentas para pago:', ...lines].join('\n'));
        }
      }
    }

    if (askedPhones) {
      const phone = this.asString(result.phone);
      const whatsapp = this.asString(result.whatsapp);
      const hasPhoneInContent = /\b\d{7,}\b/.test(normalizedContent) || normalizedContent.includes('whatsapp');

      if ((phone || whatsapp) && !hasPhoneInContent) {
        const lines = [
          phone ? `Teléfono: ${phone}` : '',
          whatsapp ? `WhatsApp: ${whatsapp}` : '',
        ].filter(Boolean);

        if (lines.length > 0) {
          segments.push(lines.join(' | '));
        }
      }
    }

    if (askedPhotos) {
      const images = Array.isArray(result.images)
        ? (result.images as Array<Record<string, unknown>>)
        : [];
      const hasUrlInContent = /https?:\/\//.test(content);

      if (images.length > 0 && !hasUrlInContent) {
        const urls = images
          .map((img) => this.asString((img as Record<string, unknown>).url))
          .filter(Boolean)
          .slice(0, 3);
        if (urls.length > 0) {
          segments.push(['Fotos:', ...urls.map((u) => `- ${u}`)].join('\n'));
        }
      }
    }

    if (segments.length === 0) return content;
    return segments.join('\n\n');
  }

  private detectCompanyInfoToolNeed(message: string): {
    campo: 'todo' | 'ubicacion' | 'horario' | 'cuentas' | 'telefonos' | 'fotos';
  } | null {
    const normalized = this.normalizeForIntent(message);

    const wantsLocation = /ubicacion|direc|direccion|donde|maps|mapa|gps|local|sucursal/.test(normalized);
    const wantsSchedule = /horario|abren|abierto|cierran|cerrado|hasta que hora|a que hora/.test(normalized);
    const wantsPayments = /cuenta|cuentas|banco|transfer|transferencia|deposit|deposito|pago|pagar|como pago|cómo pago/.test(normalized);
    const wantsPhones = /telefono|tel|whatsapp|contacto|numero|n[úu]mero|llamar|escribir/.test(normalized);
    const wantsPhotos = /foto|fotos|imagen|imagenes|logo/.test(normalized);

    if (!wantsLocation && !wantsSchedule && !wantsPayments && !wantsPhones && !wantsPhotos) {
      return null;
    }

    const hits = [wantsLocation, wantsSchedule, wantsPayments, wantsPhones, wantsPhotos].filter(Boolean).length;
    if (hits > 1) return { campo: 'todo' };
    if (wantsLocation) return { campo: 'ubicacion' };
    if (wantsSchedule) return { campo: 'horario' };
    if (wantsPayments) return { campo: 'cuentas' };
    if (wantsPhones) return { campo: 'telefonos' };
    if (wantsPhotos) return { campo: 'fotos' };
    return { campo: 'todo' };
  }

  private hasTool(tools: import('../tools/tools.types').OpenAITool[], name: string): boolean {
    return tools.some((tool) => tool.type === 'function' && (tool as any).function?.name === name);
  }

  private buildConsultarInfoEmpresaToolSpec(): import('../tools/tools.types').OpenAITool {
    return {
      type: 'function',
      function: {
        name: BotService.COMPANY_TOOL_NAME,
        description:
          'Obtiene información real de la empresa (ubicación, GPS/Maps, horarios, cuentas de pago, teléfonos y fotos). Úsala cuando el cliente pregunte por ubicación, horario, métodos de pago, cuentas bancarias o datos de contacto.',
        parameters: {
          type: 'object',
          properties: {
            campo: {
              type: 'string',
              description: 'Qué información necesitas. Si no estás seguro, usa "todo".',
              enum: ['todo', 'ubicacion', 'horario', 'cuentas', 'telefonos', 'fotos'],
            },
          },
          required: [],
        },
      },
    } as any;
  }

  private normalizeForIntent(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  }

  private intentToBotDecisionIntent(intent: BotIntent): BotDecisionIntent {
    if (intent === 'compra') return 'compra';
    if (intent === 'duda') return 'duda';
    if (intent === 'interes') return 'interesado';
    return 'info';
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

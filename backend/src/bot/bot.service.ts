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

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

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

    const config = await this.clientConfigService.getConfig();
    const botConfig = await this.botConfigService.getConfig();

    await this.memoryService.saveMessage({
      contactId: normalizedContactId,
      role: 'user',
      content: normalizedMessage,
    });

    const memoryWindow = config.aiSettings?.memoryWindow ?? 6;
    const memoryContext = await this.memoryService.getConversationContext(
      normalizedContactId,
      memoryWindow,
    );
    const history: StoredMessage[] = memoryContext.messages.filter(
      (m) => !(m.role === 'user' && m.content === normalizedMessage),
    );

    const lastAssistantMessage = [...history].reverse().find((m) => m.role === 'assistant');
    const effectiveMessage = this.buildEffectiveUserMessage(
      normalizedMessage,
      lastAssistantMessage?.content,
    );

    const systemPrompt = await this.buildKnowledgeContext(
      config,
      botConfig,
      memoryContext.clientMemory,
      memoryContext.summary,
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
      }),
    );

    const rawToolsConfig = this.asRecord(
      this.asRecord(config.configurations).tools,
    );
    const toolsConfig = this.toolsService.resolveConfig(rawToolsConfig);
    const openAiTools = this.toolsService.buildOpenAITools(toolsConfig);
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
          executeToolCall: (toolName, args) =>
            this.toolsExecutor.execute(toolName, args, normalizedContactId, toolsConfig),
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

    const finalReply = this.repairToolGroundedReply(
      normalizedMessage,
      aiReply.content.trim(),
      aiReply.toolResults ?? [],
    );

    await this.memoryService.saveMessage({
      contactId: normalizedContactId,
      role: 'assistant',
      content: finalReply,
    });

    const hotLead = this.detectHotLead(normalizedMessage);
    const intent = this.detectIntent(normalizedMessage);
    const usedMemory = history.length > 0;
    const replyType = metadata?.messageType === 'audio' ? 'audio' : 'text';

    const result: BotReplyResult = {
      reply: finalReply,
      replyType,
      mediaFiles: [],
      intent,
      decisionIntent: this.intentToBotDecisionIntent(intent),
      stage: 'curioso' as ContactStage,
      action: (hotLead ? 'cerrar' : 'guiar') as BotDecisionAction,
      purchaseIntentScore: hotLead ? 80 : 15,
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
  ): Promise<string> {
    const instructions = this.promptComposerService.buildInstructionsBlock(config, botConfig);
    const products = [
      'El catálogo de productos vive en la base de datos y se consulta por tools.',
      'Para responder con datos exactos:',
      '- Si el cliente pregunta productos, catálogo, precio, disponibilidad, stock o total, DEBES usar la tool aplicable antes de responder.',
      '- Usa consultar_catalogo cuando el cliente pregunte qué vendes o pida lista de productos.',
      '- Usa consultar_stock cuando el cliente pregunte por disponibilidad/stock.',
      '- Usa generar_cotizacion cuando el cliente quiera el total (incluye envío).',
      'No inventes productos, precios o stock si no consultaste las tools.',
    ].join('\n');
    const company = [
      'La información real de la empresa vive en la base de datos y se consulta por tools.',
      'Para responder con datos exactos:',
      '- Si el cliente pregunta ubicación, horario, cuentas, teléfonos, contacto o fotos, DEBES usar consultar_info_empresa antes de responder.',
      '- Usa consultar_info_empresa cuando el cliente pregunte por ubicación, horario, cuentas de pago, teléfonos o fotos.',
      'No inventes dirección, GPS, horarios, cuentas ni teléfonos si no consultaste la tool.',
    ].join('\n');
    const memory = this.buildMemoryBlock(clientMemory, conversationSummary);

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

    return lines.join('\n');
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

  private buildEffectiveUserMessage(message: string, lastAssistant?: string): string {
    const normalized = this.normalizeForIntent(message);
    if (!this.isShortContinuation(normalized) || !lastAssistant?.trim()) {
      return message;
    }

    return [
      message,
      '',
      '[CONTEXTO DE CONTINUIDAD]',
      'El usuario está respondiendo de forma corta al último mensaje del bot.',
      `Último mensaje del bot: ${lastAssistant.trim().slice(0, 500)}`,
      'Interpreta la respuesta según ese contexto; no saludes de nuevo ni cambies de tema.',
    ].join('\n');
  }

  private isShortContinuation(normalized: string): boolean {
    return [
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
    ].includes(normalized);
  }

  private repairToolGroundedReply(
    message: string,
    content: string,
    toolResults: import('../tools/tools.types').ToolExecutionResult[],
  ): string {
    const normalized = this.normalizeForIntent(message);
    const askedLocation = /ubicacion|direccion|donde|maps|mapa|tienda/.test(normalized);
    if (!askedLocation) return content;

    const companyTool = toolResults.find((r) => r.toolName === 'consultar_info_empresa');
    const result = this.asRecord(companyTool?.result);
    const address = this.asString(result.address);
    if (!address) return content;

    const normalizedContent = this.normalizeForIntent(content);
    const normalizedAddress = this.normalizeForIntent(address);
    if (normalizedAddress && normalizedContent.includes(normalizedAddress.slice(0, Math.min(20, normalizedAddress.length)))) {
      return content;
    }

    const companyName = this.asString(result.companyName) || 'nuestra tienda';
    const maps = this.asString(result.googleMapsLink);
    return [
      `${companyName} está ubicada en ${address}.`,
      maps ? `Mapa: ${maps}` : '',
      '¿Quieres que también te pase el horario?',
    ]
      .filter(Boolean)
      .join(' ');
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

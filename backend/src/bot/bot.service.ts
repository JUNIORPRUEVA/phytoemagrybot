import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { BotConfigService } from '../bot-config/bot-config.service';
import { CompanyContextService } from '../company-context/company-context.service';
import { ClientConfigService } from '../config/config.service';
import { MemoryService } from '../memory/memory.service';
import { StoredMessage } from '../memory/memory.types';
import { BotDecisionAction, BotDecisionIntent, ContactStage } from './bot-decision.types';
import { BotIntent, BotReplyResult, BotTestReport, BotTestStepResult } from './bot.types';
import { ToolsService } from '../tools/tools.service';
import { ToolsExecutor } from '../tools/tools.executor';

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
    private readonly companyContextService: CompanyContextService,
    private readonly clientConfigService: ClientConfigService,
    private readonly memoryService: MemoryService,
    private readonly toolsService: ToolsService,
    private readonly toolsExecutor: ToolsExecutor,
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
          message: normalizedMessage,
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
          message: normalizedMessage,
        });

    const finalReply = aiReply.content.trim();

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
    const instructions = this.buildInstructionsBlock(config, botConfig);
    const products = this.buildProductsBlock(config);
    const company = (await this.companyContextService.buildAgentContext()).trim();
    const memory = this.buildMemoryBlock(clientMemory, conversationSummary);

    const blocks: string[] = [
      '[INSTRUCCIONES]',
      instructions || 'Sin instrucciones configuradas.',
      '[PRODUCTOS]',
      products || 'Usa la herramienta consultar_catalogo para ver los productos disponibles. No inventes productos si no tienes la información.',
      '[EMPRESA]',
      company || 'Información de empresa no configurada.',
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

  private buildInstructionsBlock(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
    botConfig: Awaited<ReturnType<BotConfigService['getConfig']>>,
  ): string {
    const configurations = this.asRecord(config.configurations);
    const instructions = this.asRecord(configurations.instructions);
    const identity = this.asRecord(instructions.identity);
    const rules = this.asStringList(instructions.rules);
    const salesPrompts = this.asRecord(instructions.salesPrompts);

    // Prompt sessions configured from the Prompts page (configurations.prompts)
    const prompts = this.asRecord(configurations.prompts);
    const greetingPrompt = this.asString(prompts.greeting);
    const companyInfoPrompt = this.asString(prompts.companyInfo);
    const productInfoPrompt = this.asString(prompts.productInfo);
    const salesGuidelinesPrompt = this.asString(prompts.salesGuidelines);
    const objectionHandlingPrompt = this.asString(prompts.objectionHandling);
    const closingPrompt = this.asString(prompts.closingPrompt);
    const supportPrompt = this.asString(prompts.supportPrompt);

    const basePrompt = [config.promptBase, this.botConfigService.getFullPrompt(botConfig)]
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n\n');

    const lines: string[] = [];
    if (basePrompt) lines.push(basePrompt);

    // Identity fields from configurations.instructions.identity
    const identityFields = [
      this.asString(identity.assistantName) ? 'Nombre: ' + this.asString(identity.assistantName) : '',
      this.asString(identity.role) ? 'Rol: ' + this.asString(identity.role) : '',
      this.asString(identity.objective) ? 'Objetivo: ' + this.asString(identity.objective) : '',
      this.asString(identity.tone) ? 'Tono: ' + this.asString(identity.tone) : '',
      this.asString(identity.personality) ? 'Personalidad: ' + this.asString(identity.personality) : '',
      this.asString(identity.responseStyle) ? 'Estilo: ' + this.asString(identity.responseStyle) : '',
      this.asString(identity.signature) ? 'Firma: ' + this.asString(identity.signature) : '',
      this.asString(identity.guardrails) ? 'Guardrails: ' + this.asString(identity.guardrails) : '',
    ].filter(Boolean);

    if (identityFields.length > 0) lines.push(identityFields.join('\n'));

    // Rules from configurations.instructions.rules
    if (rules.length > 0) {
      lines.push('Reglas:\n' + rules.map((r) => '- ' + r).join('\n'));
    }

    // Sales prompts from configurations.instructions.salesPrompts
    const salesFields = [
      this.asString(salesPrompts.opening) ? 'Apertura: ' + this.asString(salesPrompts.opening) : '',
      this.asString(salesPrompts.qualification) ? 'Calificacion: ' + this.asString(salesPrompts.qualification) : '',
      this.asString(salesPrompts.offer) ? 'Oferta: ' + this.asString(salesPrompts.offer) : '',
      this.asString(salesPrompts.objectionHandling) ? 'Objeciones: ' + this.asString(salesPrompts.objectionHandling) : '',
      this.asString(salesPrompts.closing) ? 'Cierre: ' + this.asString(salesPrompts.closing) : '',
      this.asString(salesPrompts.followUp) ? 'Seguimiento: ' + this.asString(salesPrompts.followUp) : '',
    ].filter(Boolean);

    if (salesFields.length > 0) {
      lines.push('Ventas:\n' + salesFields.join('\n'));
    }

    // Prompt sessions from the Prompts page (configurations.prompts) — these are
    // the most important instructions; every non-empty session is injected verbatim
    // so the bot fully follows each configured section.
    if (greetingPrompt) lines.push('[SALUDO]\n' + greetingPrompt);
    if (companyInfoPrompt) lines.push('[EMPRESA - INSTRUCCIONES]\n' + companyInfoPrompt);
    if (productInfoPrompt) lines.push('[PRODUCTOS - INSTRUCCIONES]\n' + productInfoPrompt);
    if (salesGuidelinesPrompt) lines.push('[VENTAS Y CONVERSION]\n' + salesGuidelinesPrompt);
    if (objectionHandlingPrompt) lines.push('[MANEJO DE OBJECIONES]\n' + objectionHandlingPrompt);
    if (closingPrompt) lines.push('[CIERRE]\n' + closingPrompt);
    if (supportPrompt) lines.push('[SOPORTE Y POSTVENTA]\n' + supportPrompt);

    return lines.join('\n\n');
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
    const normalized = message.trim().toLowerCase();
    if (this.detectHotLead(message)) return 'compra';
    if (/precio|cuanto cuesta|cu.nto cuesta|cuanto vale|cu.nto vale/.test(normalized)) return 'interes';
    if (/funciona|sirve|beneficio|resultado|verdad/.test(normalized)) return 'duda';
    return 'otro';
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

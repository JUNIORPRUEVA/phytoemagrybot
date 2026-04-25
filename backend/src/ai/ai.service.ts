import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { BotDecisionAction, BotDecisionIntent } from '../bot/bot-decision.types';
import { AppConfigRecord } from '../config/config.types';
import { StoredMessage } from '../memory/memory.types';
import {
  AssistantReply,
  AssistantResponseCandidate,
  AssistantLeadStage,
  AssistantReplyObjective,
  AssistantResponseStyle,
  GenerateReplyParams,
} from './ai.types';

@Injectable()
export class AiService {
  private static readonly MIN_REPLY_MAX_TOKENS = 420;
  private static readonly RETRY_REPLY_MAX_TOKENS = 720;

  async generateResponses(params: GenerateReplyParams): Promise<AssistantResponseCandidate[]> {
    const {
      config,
      fullPrompt,
      companyContext,
      contactId,
      history,
      message,
      context,
      classifiedIntent,
      decisionAction,
      purchaseIntentScore,
      responseStyle,
      leadStage,
      replyObjective,
      regenerationInstruction,
      candidateCount,
    } = params;
    const aiSettings = config.aiSettings;
    const modelName = process.env.OPENAI_MODEL?.trim() || aiSettings?.modelName || 'gpt-4o-mini';
    const temperature = aiSettings?.temperature ?? 0.4;
    const configuredMaxCompletionTokens = aiSettings?.maxCompletionTokens ?? 180;
    const maxCompletionTokens = Math.max(
      configuredMaxCompletionTokens,
      AiService.MIN_REPLY_MAX_TOKENS,
    );

    if (!config.openaiKey.trim()) {
      throw new InternalServerErrorException('OpenAI API key is not configured');
    }

    try {
      const openai = new OpenAI({ apiKey: config.openaiKey });
      const messages = this.buildReplyMessages({
        config,
        fullPrompt,
        companyContext,
        contactId,
        history,
        message,
        context,
        classifiedIntent,
        decisionAction,
        purchaseIntentScore,
        responseStyle,
        leadStage,
        replyObjective,
        regenerationInstruction,
        candidateCount,
      });

      let completion = await openai.chat.completions.create({
        model: modelName,
        temperature,
        max_completion_tokens: maxCompletionTokens,
        messages,
        response_format: {
          type: 'json_object',
        },
      });

      if (
        completion.choices[0]?.finish_reason === 'length' &&
        maxCompletionTokens < AiService.RETRY_REPLY_MAX_TOKENS
      ) {
        completion = await openai.chat.completions.create({
          model: modelName,
          temperature,
          max_completion_tokens: AiService.RETRY_REPLY_MAX_TOKENS,
          messages,
          response_format: {
            type: 'json_object',
          },
        });
      }

      const response = completion.choices[0]?.message?.content?.trim();

      if (!response) {
        throw new InternalServerErrorException('OpenAI returned an empty response');
      }

      return this.parseAssistantResponses(response, Math.max(candidateCount ?? 3, 2));
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new BadGatewayException('OpenAI request failed');
    }
  }

  async generateReply(params: GenerateReplyParams): Promise<AssistantReply> {
    const candidates = await this.generateResponses({
      ...params,
      candidateCount: 3,
    });
    const first = candidates[0];

    return {
      type: first?.type === 'audio' ? 'audio' : 'text',
      content: this.normalizeReplyContent(first?.text ?? '', first?.type === 'audio' ? 'audio' : 'text'),
    };
  }

  private buildReplyMessages(params: GenerateReplyParams) {
    const memoryWindow = params.config.aiSettings?.memoryWindow ?? 6;
    const requestedCandidates = Math.max(params.candidateCount ?? 3, 2);

    return [
      {
        role: 'system' as const,
        content: this.buildSystemPromptFromConfig({
          fullPrompt: params.fullPrompt,
          contactId: params.contactId,
          config: params.config,
          classifiedIntent: params.classifiedIntent,
          decisionAction: params.decisionAction,
          purchaseIntentScore: params.purchaseIntentScore,
          responseStyle: params.responseStyle,
          leadStage: params.leadStage,
          replyObjective: params.replyObjective,
        }),
      },
      ...(params.companyContext.trim()
        ? [
            {
              role: 'system' as const,
              content: params.companyContext,
            },
          ]
        : []),
      ...(params.context.trim()
        ? [
            {
              role: 'system' as const,
              content: params.context,
            },
          ]
        : []),
      ...(params.regenerationInstruction?.trim()
        ? [
            {
              role: 'system' as const,
              content: [
                'REGENERACION OBLIGATORIA:',
                params.regenerationInstruction.trim(),
              ].join('\n'),
            },
          ]
        : []),
      {
        role: 'system' as const,
        content: [
          `Genera ${requestedCandidates} opciones distintas.` ,
          'Devuelve JSON valido con la clave "responses".',
          '"responses" debe ser un array de 2 o 3 objetos con las claves: "text", "videoId", "imageId" y "type".',
          'Usa "type" = "text" normalmente. Usa "audio" solo si de verdad corresponde responder por voz.',
          'Si no vas a usar media, omite videoId e imageId.',
          'No inventes IDs de media: si eliges media, usa solo IDs o URLs disponibles en el contexto.',
          'Cada opcion debe sonar diferente, no solo con comas o muletillas cambiadas.',
        ].join('\n'),
      },
      ...params.history.slice(-memoryWindow).map((item) => ({
        role: item.role,
        content: item.content.slice(0, 500),
      })),
      {
        role: 'user' as const,
        content: params.message.slice(0, 500),
      },
    ];
  }
  private buildSystemPromptFromConfig(params: {
    fullPrompt: string;
    contactId: string;
    config?: AppConfigRecord;
    classifiedIntent: BotDecisionIntent;
    decisionAction: BotDecisionAction;
    purchaseIntentScore: number;
    responseStyle: AssistantResponseStyle;
    leadStage: AssistantLeadStage;
    replyObjective: AssistantReplyObjective;
  }): string {
    const promptSections = this.buildBotContext(params.config);

    return [
      params.fullPrompt.trim() ||
        'Eres un asistente de ventas por WhatsApp. Responde claro, natural y con tono humano. Mantente breve, pero si el cliente pide explicacion o detalles, explica con naturalidad sin sonar robotico. Habla como una persona real dominicana y enfocate en vender bien.',
      ...promptSections,
      `Contacto actual: ${params.contactId}`,
      this.buildKnowledgePriorityInstruction(),
      this.buildThinkingFrameworkInstruction(),
      this.buildHumanSalesInstruction(),
      this.buildDecisionInstruction(
        params.classifiedIntent,
        params.decisionAction,
        params.purchaseIntentScore,
      ),
      this.buildStageInstruction(params.leadStage, params.replyObjective),
      'Responde breve, útil y alineado al negocio del cliente.',
      'Si el cliente pide que le expliques, le cuentes o le hables de un producto, responde de forma conversacional y orientativa, no con un cierre de venta automatico.',
      this.buildAntiRepetitionInstruction(),
      'Habla como una persona dominicana natural: cercana, breve y humana, sin sonar robotico.',
      this.buildResponseStyleInstruction(params.responseStyle),
      this.buildFinalValidationInstruction(),
      'El backend valida todo antes de enviar, asi que devuelve opciones útiles y distintas, no variantes casi iguales.',
    ].join('\n\n');
  }

  private buildKnowledgePriorityInstruction(): string {
    return [
      'Fuentes obligatorias antes de responder:',
      '1. Lee y obedece INSTRUCCIONES.',
      '2. Lee PRODUCTOS completos antes de redactar.',
      '3. Si existe un producto relevante, usa siempre sus datos reales como fuente principal.',
      '4. Si el producto trae imagenes o videos disponibles, asume que el bot puede usarlos para vender y no digas que no hay media sin revisar esas URLs.',
    ].join('\n');
  }

  private buildThinkingFrameworkInstruction(): string {
    return [
      'Piensa primero y responde despues. Haz este analisis de forma interna y no lo muestres:',
      '1. Que quiere realmente el cliente.',
      '2. En que etapa esta: curioso, interesado, dudoso o listo para comprar.',
      '3. Que ya se le dijo antes usando la memoria y el historial.',
      '4. Que no debes repetir.',
      '5. Cual es la mejor respuesta para avanzar la venta con naturalidad.',
      'Antes de escribir decide si conviene explicar, responder corto, cerrar o hacer una pregunta estrategica.',
    ].join('\n');
  }

  private buildHumanSalesInstruction(): string {
    return [
      'Actua como un vendedor dominicano real por WhatsApp: natural, relajado, seguro y cercano.',
      'No hables como sistema, IA, servicio automatico ni asistente formal.',
      'Cada respuesta debe tener una intencion clara: avanzar la conversacion, generar confianza, resolver la duda o cerrar la venta.',
      'Detecta emocion, duda e intencion de compra. Si el cliente esta frio, calienta la conversacion. Si esta dudoso, responde con seguridad. Si esta listo, cierra suave sin presion.',
      'Usa la memoria para aprovechar nombre, interes y dudas previas. No repitas informacion ya dada salvo que ayude a cerrar.',
      'Si preguntan precio, responde directo y con valor. Si tienen duda, responde con confianza. Si piden explicacion, explica sin sonar tecnico. Si toca cerrar, guia la compra con suavidad.',
      'Si la respuesta es de venta, interes o presentacion de producto, termina con una accion clara para avanzar: por ejemplo "te lo envio?", "cuantas quieres?" o "te gustaria pedirlo?".',
      'Evita respuestas largas, lenguaje formal, preguntas innecesarias y frases roboticas.',
      'La respuesta final debe sonar humana y vender con tacto. Ve al punto, pero completa bien la idea cuando el cliente necesite contexto, explicacion o pasos claros.',
    ].join('\n');
  }

  private buildStageInstruction(
    leadStage: AssistantLeadStage,
    replyObjective: AssistantReplyObjective,
  ): string {
    return [
      `Etapa detectada del cliente: ${leadStage}.`,
      `Objetivo principal de esta respuesta: ${replyObjective}.`,
      'Adapta el lenguaje a esa etapa: curioso = orienta y despierta interes; interesado = aclara y mueve al siguiente paso; dudoso = responde con seguridad y confianza; listo_para_comprar = facilita el cierre suave.',
    ].join('\n');
  }

  private buildDecisionInstruction(
    classifiedIntent: BotDecisionIntent,
    decisionAction: BotDecisionAction,
    purchaseIntentScore: number,
  ): string {
    return [
      `Intencion clasificada: ${classifiedIntent}.`,
      `Estrategia elegida: ${decisionAction}.`,
      `Purchase intent score actual: ${purchaseIntentScore}/100.`,
      'Sigue la estrategia sin romper el tono humano: cerrar = cierra suave; responder_precio_con_valor = da precio con valor; persuadir = responde con confianza y prueba social; guiar = orienta con una pregunta util; hacer_seguimiento = deja la puerta abierta sin presionar.',
    ].join('\n');
  }

  async classifyIntent(params: {
    config: AppConfigRecord;
    message: string;
    history?: StoredMessage[];
  }): Promise<BotDecisionIntent> {
    const { config, message, history = [] } = params;
    const text = message.trim();

    if (!text || !config.openaiKey.trim()) {
      return 'curioso';
    }

    try {
      const openai = new OpenAI({ apiKey: config.openaiKey });
      const modelName = process.env.OPENAI_MODEL?.trim() || config.aiSettings?.modelName || 'gpt-4o-mini';
      const completion = await openai.chat.completions.create({
        model: modelName,
        temperature: 0,
        max_completion_tokens: 80,
        messages: [
          {
            role: 'system',
            content: [
              'Clasifica el ultimo mensaje de un cliente de WhatsApp en una sola intencion.',
              'Responde JSON valido con la clave "intent".',
              'Etiquetas permitidas: curioso, interesado, duda, compra, no_interesado.',
              'No expliques nada.',
            ].join('\n'),
          },
          ...(history.length > 0
            ? [{
                role: 'system' as const,
                content: `Historial breve:\n${history.slice(-4).map((item) => `${item.role}: ${item.content}`).join('\n')}`,
              }]
            : []),
          {
            role: 'user',
            content: text.slice(0, 500),
          },
        ],
        response_format: {
          type: 'json_object',
        },
      });

      const raw = completion.choices[0]?.message?.content?.trim();
      if (!raw) {
        return 'curioso';
      }

      const parsed = JSON.parse(raw) as { intent?: string };
      switch (parsed.intent) {
        case 'curioso':
        case 'interesado':
        case 'duda':
        case 'compra':
        case 'no_interesado':
          return parsed.intent;
        default:
          return 'curioso';
      }
    } catch {
      return 'curioso';
    }
  }

  private buildAntiRepetitionInstruction(): string {
    return [
      'No repitas literalmente frases, cierres ni ideas que ya aparezcan en el historial, salvo que sea estrictamente necesario.',
      'Si necesitas retomar algo dicho antes, dilo con otras palabras y solo si ayuda a avanzar la venta.',
      'Cada opcion propuesta debe ser realmente diferente de las otras opciones.',
    ].join('\n');
  }

  private buildFinalValidationInstruction(): string {
    return [
      'Antes de enviar la respuesta verifica internamente:',
      '- Suena humano.',
      '- No suena robotico.',
      '- Ayuda a vender o avanzar la conversacion.',
      '- Conecta con lo que el cliente realmente necesita en este momento.',
      '- Si es una respuesta comercial, termina con un siguiente paso claro.',
      'Si no cumple, reescribela antes de devolverla.',
    ].join('\n');
  }

  private buildResponseStyleInstruction(style: AssistantResponseStyle): string {
    if (style === 'brief') {
      return 'Modo de respuesta: breve. Si preguntan precio, disponibilidad, envio o una duda puntual, responde directo y concreto. Pero no dejes frases a medias ni recortes informacion necesaria: si hace falta una segunda o tercera frase para completar bien la idea, incluyela.';
    }

    if (style === 'detailed') {
      return 'Modo de respuesta: con contexto. Si piden informacion, explicacion, beneficios, contenido o como funciona, responde con suficiente contexto, de forma natural y ordenada, completando la idea de principio a fin sin sonar largo ni robotico.';
    }

    return 'Modo de respuesta: equilibrado. Responde natural, clara y util, sin quedarte corto ni hablar de mas. Prioriza que la respuesta salga completa y entendible.';
  }

  private buildBotContext(config?: AppConfigRecord): string[] {
    const configurations = this.asRecord(config?.configurations);
    const instructions = this.asRecord(configurations.instructions);
    const identity = this.asRecord(instructions.identity);
    const rules = this.asStringList(instructions.rules);
    const salesPrompts = this.asRecord(instructions.salesPrompts);
    const rawProducts = Array.isArray(instructions.products)
      ? instructions.products
      : [];
    const sections: string[] = [];

    this.appendStructuredFields(sections, 'Identidad y comportamiento del bot', [
      ['Nombre interno del bot', identity['assistantName']],
      ['Rol comercial', identity['role']],
      ['Objetivo principal', identity['objective']],
      ['Tono de voz', identity['tone']],
      ['Personalidad', identity['personality']],
      ['Estilo de respuesta', identity['responseStyle']],
      ['Firma o cierre sugerido', identity['signature']],
      ['Guardrails e instrucciones criticas', identity['guardrails']],
    ]);

    if (rules.length > 0) {
      sections.push(`Reglas del bot:\n${rules.map((rule) => `- ${rule}`).join('\n')}`);
    }

    this.appendStructuredFields(sections, 'Prompts de ventas', [
      ['Apertura', salesPrompts['opening']],
      ['Calificacion', salesPrompts['qualification']],
      ['Presentacion de oferta', salesPrompts['offer']],
      ['Manejo de objeciones', salesPrompts['objectionHandling']],
      ['Cierre', salesPrompts['closing']],
      ['Seguimiento', salesPrompts['followUp']],
    ]);

    const productBlocks = rawProducts
      .map((item) => this.formatProductBlock(item))
      .filter((item): item is string => Boolean(item));

    if (productBlocks.length > 0) {
      sections.push(`Productos disponibles:\n${productBlocks.join('\n\n')}`);
    }

    sections.push(...this.readLegacyPromptSections(configurations));

    return sections;
  }

  private readLegacyPromptSections(configurations: Record<string, unknown>): string[] {
    const prompts = this.asRecord(configurations.prompts);
    const sections: string[] = [];

    this.appendPromptSection(sections, 'Saludo inicial', prompts['greeting']);
    this.appendPromptSection(sections, 'Informacion de la empresa', prompts['companyInfo']);
    this.appendPromptSection(sections, 'Catalogo y detalles de productos', prompts['productInfo']);
    this.appendPromptSection(sections, 'Guia comercial y tono de ventas', prompts['salesGuidelines']);
    this.appendPromptSection(sections, 'Manejo de objeciones', prompts['objectionHandling']);
    this.appendPromptSection(sections, 'Cierre y conversion', prompts['closingPrompt']);
    this.appendPromptSection(sections, 'Soporte y postventa', prompts['supportPrompt']);

    return sections;
  }

  private appendStructuredFields(
    sections: string[],
    title: string,
    fields: Array<[string, unknown]>,
  ): void {
    const lines = fields
      .map(([label, value]) => {
        const content = typeof value === 'string' ? value.trim() : '';
        return content ? `- ${label}: ${content}` : '';
      })
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return;
    }

    sections.push(`${title}:\n${lines.join('\n')}`);
  }

  private appendPromptSection(
    sections: string[],
    title: string,
    value: unknown,
  ): void {
    const content = typeof value === 'string' ? value.trim() : '';

    if (!content) {
      return;
    }

    sections.push(`${title}:\n${content}`);
  }

  private formatProductBlock(value: unknown): string | null {
    const product = this.asRecord(value);
    const name = this.asString(product.titulo) || this.asString(product.title) || this.asString(product.name);

    if (!name) {
      return null;
    }

    const lines = [
      name,
      this.formatProductField('ID', product.id),
      this.formatProductField('Descripcion corta', product.descripcion_corta ?? product.descripcionCorta ?? product.summary),
      this.formatProductField('Descripcion completa', product.descripcion_completa ?? product.descripcionCompleta ?? product.description),
      this.formatProductField('Precio', product.precio ?? product.price),
      this.formatProductField('Precio minimo', product.precio_minimo ?? product.precioMinimo),
      this.formatProductField('Imagenes', this.asStringList(product.imagenes).join(', ')),
      this.formatProductField('Videos', this.asStringList(product.videos).join(', ')),
      this.formatProductField('Categoria', product.category),
      this.formatProductField('Resumen', product.summary),
      this.formatProductField('CTA', product.cta),
      this.formatProductField('Beneficios', product.benefits),
      this.formatProductField('Uso recomendado', product.usage),
      this.formatProductField('Notas comerciales', product.notes),
      this.formatProductField('Palabras clave', this.asStringList(product.keywords).join(', ')),
    ].filter((line) => line.length > 0);

    return lines.join('\n');
  }

  private formatProductField(label: string, value: unknown): string {
    const content =
      typeof value === 'number'
        ? value.toString()
        : typeof value === 'string'
          ? value.trim()
          : '';
    return content ? `- ${label}: ${content}` : '';
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

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private parseAssistantReply(response: string): AssistantReply {
    const candidates = this.parseAssistantResponses(response, 1);
    const first = candidates[0];

    if (first) {
      return {
        type: first.type === 'audio' ? 'audio' : 'text',
        content: this.normalizeReplyContent(first.text, first.type === 'audio' ? 'audio' : 'text'),
      };
    }

    throw new InternalServerErrorException('OpenAI returned an invalid response payload');
  }

  private parseAssistantResponses(
    response: string,
    minimumCount: number,
  ): AssistantResponseCandidate[] {
    try {
      const parsed = JSON.parse(response) as {
        responses?: Array<Partial<AssistantResponseCandidate>>;
        type?: AssistantReply['type'];
        content?: string;
      };

      if (Array.isArray(parsed.responses)) {
        const candidates = parsed.responses
          .map((candidate) => this.normalizeResponseCandidate(candidate))
          .filter((candidate): candidate is AssistantResponseCandidate => candidate !== null);

        if (candidates.length >= Math.min(minimumCount, 2)) {
          return candidates.slice(0, 3);
        }
      }

      if (typeof parsed.content === 'string' && parsed.content.trim()) {
        const replyType = parsed.type === 'audio' ? 'audio' : 'text';
        return [{
          type: replyType,
          text: this.normalizeReplyContent(parsed.content, replyType),
        }];
      }
    } catch {
      return [{
        type: 'text',
        text: this.normalizeReplyContent(response, 'text'),
      }];
    }

    throw new InternalServerErrorException('OpenAI returned an invalid response payload');
  }

  private normalizeResponseCandidate(
    candidate: Partial<AssistantResponseCandidate>,
  ): AssistantResponseCandidate | null {
    if (typeof candidate.text !== 'string' || candidate.text.trim().length === 0) {
      return null;
    }

    const text = this.normalizeReplyContent(candidate.text, candidate.type === 'audio' ? 'audio' : 'text');
    if (!text) {
      return null;
    }

    const normalized: AssistantResponseCandidate = {
      text,
      type: candidate.type === 'audio' ? 'audio' : 'text',
    };

    if (typeof candidate.videoId === 'string' && candidate.videoId.trim()) {
      normalized.videoId = candidate.videoId.trim();
    }

    if (typeof candidate.imageId === 'string' && candidate.imageId.trim()) {
      normalized.imageId = candidate.imageId.trim();
    }

    return normalized;
  }

  private normalizeReplyContent(
    content: string,
    _replyType: AssistantReply['type'],
  ): string {
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');
  }
}
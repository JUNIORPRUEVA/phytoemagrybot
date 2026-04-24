import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigRecord } from '../config/config.types';
import {
  AssistantReply,
  AssistantResponseStyle,
  GenerateReplyParams,
} from './ai.types';

@Injectable()
export class AiService {
  async generateReply(params: GenerateReplyParams): Promise<AssistantReply> {
    const { config, fullPrompt, contactId, history, message, context, responseStyle } = params;
    const aiSettings = config.aiSettings;
    const modelName = process.env.OPENAI_MODEL?.trim() || aiSettings?.modelName || 'gpt-4o-mini';
    const temperature = aiSettings?.temperature ?? 0.4;
    const maxCompletionTokens = aiSettings?.maxCompletionTokens ?? 180;
    const memoryWindow = aiSettings?.memoryWindow ?? 6;

    if (!config.openaiKey.trim()) {
      throw new InternalServerErrorException('OpenAI API key is not configured');
    }

    try {
      const openai = new OpenAI({ apiKey: config.openaiKey });

      const completion = await openai.chat.completions.create({
        model: modelName,
        temperature,
        max_completion_tokens: maxCompletionTokens,
        messages: [
          {
            role: 'system',
            content: this.buildSystemPromptFromConfig({
              fullPrompt,
              contactId,
              config,
              responseStyle,
            }),
          },
          ...(context.trim()
            ? [
                {
                  role: 'system' as const,
                  content: context,
                },
              ]
            : []),
          ...history.slice(-memoryWindow).map((item) => ({
            role: item.role,
            content: item.content.slice(0, 500),
          })),
          {
            role: 'user',
            content: message.slice(0, 500),
          },
        ],
        response_format: {
          type: 'json_object',
        },
      });

      const response = completion.choices[0]?.message?.content?.trim();

      if (!response) {
        throw new InternalServerErrorException('OpenAI returned an empty response');
      }

      return this.parseAssistantReply(response);
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new BadGatewayException('OpenAI request failed');
    }
  }
  private buildSystemPromptFromConfig(params: {
    fullPrompt: string;
    contactId: string;
    config?: AppConfigRecord;
    responseStyle: AssistantResponseStyle;
  }): string {
    const promptSections = this.readPromptSections(params.config?.configurations);

    return [
      params.fullPrompt.trim() ||
        'Eres un asistente de ventas por WhatsApp. Responde claro, natural y con tono humano. Mantente breve, pero si el cliente pide explicacion o detalles, explica con naturalidad sin sonar robotico. Habla como una persona real dominicana y enfocate en vender bien.',
      ...promptSections,
      `Contacto actual: ${params.contactId}`,
      'Responde breve, útil y alineado al negocio del cliente.',
      'Si el cliente pide que le expliques, le cuentes o le hables de un producto, responde de forma conversacional y orientativa, no con un cierre de venta automatico.',
      this.buildResponseStyleInstruction(params.responseStyle),
      'Devuelve siempre un JSON valido con las claves "type" y "content".',
      'Usa type="text" para respuestas normales.',
      'Usa type="audio" solo cuando el usuario pida explicitamente una respuesta en audio o voz.',
    ].join('\n\n');
  }

  private buildResponseStyleInstruction(style: AssistantResponseStyle): string {
    if (style === 'brief') {
      return 'Modo de respuesta: breve. Si preguntan precio, disponibilidad, envio o una duda puntual, responde directo y concreto. Da solo lo necesario y como mucho una pregunta corta para avanzar la conversacion.';
    }

    if (style === 'detailed') {
      return 'Modo de respuesta: con contexto. Si piden informacion, explicacion, beneficios, contenido o como funciona, responde con suficiente contexto, de forma natural y ordenada, sin sonar largo ni robotico.';
    }

    return 'Modo de respuesta: equilibrado. Responde natural, clara y util, sin quedarte corto ni hablar de mas.';
  }

  private readPromptSections(configurations: unknown): string[] {
    const prompts = this.asRecord(this.asRecord(configurations).prompts);
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

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private parseAssistantReply(response: string): AssistantReply {
    try {
      const parsed = JSON.parse(response) as Partial<AssistantReply>;

      if (typeof parsed.content === 'string' && parsed.content.trim()) {
        const replyType = parsed.type === 'audio' ? 'audio' : 'text';
        return {
          type: replyType,
          content: this.normalizeReplyContent(parsed.content, replyType),
        };
      }
    } catch {
      return {
        type: 'text',
        content: this.normalizeReplyContent(response, 'text'),
      };
    }

    throw new InternalServerErrorException('OpenAI returned an invalid response payload');
  }

  private normalizeReplyContent(
    content: string,
    replyType: AssistantReply['type'],
  ): string {
    const compact = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, replyType === 'audio' ? 3 : 2)
      .join('\n');

    const words = compact.split(/\s+/).filter((word) => word.length > 0);
    const maxWords = replyType === 'audio' ? 45 : 28;
    if (words.length <= maxWords) {
      return compact;
    }

    return words.slice(0, maxWords).join(' ');
  }
}
import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { AssistantReply, GenerateReplyParams } from './ai.types';

@Injectable()
export class AiService {
  async generateReply(params: GenerateReplyParams): Promise<AssistantReply> {
    const { config, contactId, history, message, summary } = params;

    try {
      const openai = new OpenAI({ apiKey: config.openaiKey });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: this.buildSystemPrompt(config.promptBase, contactId, summary),
          },
          ...history.map((item) => ({
            role: item.role,
            content: item.content,
          })),
          {
            role: 'user',
            content: message,
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

  async summarizeConversation(params: GenerateReplyParams): Promise<string | null> {
    const { config, history, summary } = params;

    if (history.length < 6) {
      return summary ?? null;
    }

    try {
      const openai = new OpenAI({ apiKey: config.openaiKey });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'Summarize the conversation in Spanish with operational context, user preferences, unresolved issues, and next actions in under 1200 characters.',
          },
          {
            role: 'user',
            content: JSON.stringify({ summary, history }),
          },
        ],
      });

      return completion.choices[0]?.message?.content?.trim() ?? summary ?? null;
    } catch {
      return summary ?? null;
    }
  }

  private buildSystemPrompt(
    promptBase: string,
    contactId: string,
    summary?: string | null,
  ): string {
    return [
      promptBase,
      `Contacto actual: ${contactId}`,
      summary ? `Resumen previo: ${summary}` : 'Resumen previo: sin resumen todavía.',
      'Responde de forma clara, útil y alineada al negocio del cliente.',
      'Devuelve siempre un JSON valido con las claves "type" y "content".',
      'Usa type="text" para respuestas normales.',
      'Usa type="audio" solo cuando el usuario pida explicitamente una respuesta en audio o voz.',
    ].join('\n\n');
  }

  private parseAssistantReply(response: string): AssistantReply {
    try {
      const parsed = JSON.parse(response) as Partial<AssistantReply>;

      if (typeof parsed.content === 'string' && parsed.content.trim()) {
        return {
          type: parsed.type === 'audio' ? 'audio' : 'text',
          content: parsed.content.trim(),
        };
      }
    } catch {
      return {
        type: 'text',
        content: response,
      };
    }

    throw new InternalServerErrorException('OpenAI returned an invalid response payload');
  }
}
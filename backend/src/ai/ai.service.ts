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
    const { config, contactId, history, message } = params;

    if (!config.openaiKey.trim()) {
      throw new InternalServerErrorException('OpenAI API key is not configured');
    }

    try {
      const openai = new OpenAI({ apiKey: config.openaiKey });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_completion_tokens: 180,
        messages: [
          {
            role: 'system',
            content: this.buildSystemPrompt(config.promptBase, contactId),
          },
          ...history.slice(-6).map((item) => ({
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
  private buildSystemPrompt(promptBase: string, contactId: string): string {
    return [
      promptBase.trim() ||
        'Eres un asistente profesional de WhatsApp. Responde con claridad, foco comercial y tono amable.',
      `Contacto actual: ${contactId}`,
      'Responde breve, útil y alineado al negocio del cliente.',
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
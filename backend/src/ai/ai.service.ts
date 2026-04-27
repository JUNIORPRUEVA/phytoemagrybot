import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { StoredMessage } from '../memory/memory.types';
import {
  AssistantReply,
  AssistantResponseCandidate,
  GenerateReplyParams,
  SimpleGenerateReplyParams,
} from './ai.types';

@Injectable()
export class AiService {
  private static readonly DEFAULT_MAX_TOKENS = 420;
  private static readonly MEMORY_WINDOW = 6;

  /**
   * Simple reply for BotService.
   * System message = 3-module knowledge context ([INSTRUCCIONES] + [PRODUCTOS] + [EMPRESA]).
   */
  async generateSimpleReply(params: SimpleGenerateReplyParams): Promise<AssistantReply> {
    if (!params.openaiKey.trim()) {
      throw new InternalServerErrorException('OpenAI API key is not configured');
    }

    const openai = new OpenAI({ apiKey: params.openaiKey });
    const modelName = params.modelName?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
    const temperature = params.temperature ?? 0.4;
    const maxTokens = Math.max(
      params.maxTokens ?? AiService.DEFAULT_MAX_TOKENS,
      AiService.DEFAULT_MAX_TOKENS,
    );

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.systemPrompt },
      ...params.history.slice(-AiService.MEMORY_WINDOW).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content.slice(0, 500),
      })),
      { role: 'user', content: params.message.slice(0, 500) },
    ];

    try {
      const completion = await openai.chat.completions.create({
        model: modelName,
        temperature,
        max_completion_tokens: maxTokens,
        messages,
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new InternalServerErrorException('OpenAI returned an empty response');
      }

      return { type: 'text', content };
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      throw new BadGatewayException('OpenAI request failed');
    }
  }

  /**
   * Legacy method used by FollowupService.
   * Builds system from fullPrompt + companyContext + context and returns candidate list.
   */
  async generateResponses(params: GenerateReplyParams): Promise<AssistantResponseCandidate[]> {
    const {
      config,
      fullPrompt,
      companyContext,
      history,
      message,
      context,
      regenerationInstruction,
    } = params;

    if (!config.openaiKey.trim()) {
      throw new InternalServerErrorException('OpenAI API key is not configured');
    }

    const openai = new OpenAI({ apiKey: config.openaiKey });
    const modelName =
      process.env.OPENAI_MODEL?.trim() || config.aiSettings?.modelName || 'gpt-4o-mini';
    const temperature = config.aiSettings?.temperature ?? 0.4;
    const maxTokens = Math.max(
      config.aiSettings?.maxCompletionTokens ?? AiService.DEFAULT_MAX_TOKENS,
      AiService.DEFAULT_MAX_TOKENS,
    );
    const memoryWindow = config.aiSettings?.memoryWindow ?? AiService.MEMORY_WINDOW;

    const systemParts = [fullPrompt, companyContext, context, regenerationInstruction]
      .map((s) => (s ?? '').trim())
      .filter(Boolean);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: systemParts.join('\n\n') || 'Eres un vendedor por WhatsApp.',
      },
      ...history.slice(-memoryWindow).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content.slice(0, 500),
      })),
      { role: 'user', content: message.slice(0, 500) },
    ];

    try {
      const completion = await openai.chat.completions.create({
        model: modelName,
        temperature,
        max_completion_tokens: maxTokens,
        messages,
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new InternalServerErrorException('OpenAI returned an empty response');
      }

      return [{ type: 'text', text: content }];
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      throw new BadGatewayException('OpenAI request failed');
    }
  }

  async generateReply(params: GenerateReplyParams): Promise<AssistantReply> {
    const candidates = await this.generateResponses(params);
    const first = candidates[0];
    return { type: 'text', content: first?.text ?? '' };
  }

  async classifyIntent(_params: {
    config: import('../config/config.types').AppConfigRecord;
    message: string;
    history?: StoredMessage[];
  }): Promise<import('../bot/bot-decision.types').BotDecisionIntent> {
    return 'curioso';
  }
}

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
  GenerateReplyWithToolsParams,
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
   * Reply with OpenAI Function Calling. Executes up to 3 tool-call rounds.
   */
  async generateReplyWithTools(params: GenerateReplyWithToolsParams): Promise<AssistantReply> {
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

    const toolsUsed: string[] = [];
    const toolResults: import('../tools/tools.types').ToolExecutionResult[] = [];
    const MAX_ROUNDS = 3;

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const completion = await openai.chat.completions.create({
          model: modelName,
          temperature,
          max_completion_tokens: maxTokens,
          messages,
          tools: params.tools,
          tool_choice: 'auto',
        });

        const choice = completion.choices[0];
        if (!choice) throw new InternalServerErrorException('OpenAI returned no choices');

        const assistantMessage = choice.message;
        messages.push(assistantMessage as OpenAI.ChatCompletionMessageParam);

        // No tool calls — final answer
        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
          const content = assistantMessage.content?.trim();
          if (!content) throw new InternalServerErrorException('OpenAI returned an empty response');
          return { type: 'text', content, toolsUsed, toolResults };
        }

        // Execute each tool call
        for (const toolCall of assistantMessage.tool_calls) {
          const fnName = toolCall.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
          } catch {
            // keep empty args
          }

          toolsUsed.push(fnName);
          const result = await params.executeToolCall(fnName, args);
          toolResults.push(result);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }

        messages.push({
          role: 'system',
          content:
            'Ya recibiste resultados de tools. Responde ahora usando esos datos concretos. Si la tool trae dirección, horario, teléfono, catálogo, precio, stock o total, incluye el dato real en la respuesta. No respondas genérico ni preguntes si puedes ayudar sin contestar lo pedido.',
        });
      }

      // Fallback: ask for a final answer without tools
      const fallback = await openai.chat.completions.create({
        model: modelName,
        temperature,
        max_completion_tokens: maxTokens,
        messages,
      });
      const content = fallback.choices[0]?.message?.content?.trim();
      if (!content) throw new InternalServerErrorException('OpenAI returned an empty response');
      return { type: 'text', content, toolsUsed, toolResults };
    } catch (error) {
      if (
        error instanceof InternalServerErrorException ||
        error instanceof BadGatewayException
      ) throw error;
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

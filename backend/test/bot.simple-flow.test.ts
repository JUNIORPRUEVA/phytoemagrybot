import assert from 'node:assert/strict';
import test from 'node:test';

import { BotService } from '../src/bot/bot.service';
import { PromptComposerService } from '../src/bot/prompt-composer.service';

const DEFAULT_AI_REPLY = 'Hola, claro. Te ayudo ahora mismo.';

function createService(options?: {
  aiReply?: string;
  toolReply?: string;
  toolResults?: Array<{ toolName: string; result: Record<string, unknown> }>;
  openAiTools?: unknown[];
  onGenerateSimpleReply?: (params: Record<string, unknown>) => void;
  onGenerateToolReply?: (params: Record<string, unknown>) => void;
  configPromptBase?: string;
  botFullPrompt?: string;
  configConfigurations?: Record<string, unknown>;
}) {
  let savedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const botConfigService = {
    async getConfig() {
      return {
        promptBase: 'LEGACY_BOT_BASE',
        promptShort: '',
        promptHuman: '',
        promptSales: '',
      };
    },
    getFullPrompt() {
      return options?.botFullPrompt ?? 'LEGACY_BOT_PROMPT';
    },
  } as any;

  const promptComposerService = new PromptComposerService(botConfigService);

  return new BotService(
    {
      async generateSimpleReply(params: Record<string, unknown>) {
        options?.onGenerateSimpleReply?.(params);
        return {
          type: 'text' as const,
          content: options?.aiReply ?? DEFAULT_AI_REPLY,
        };
      },
      async generateReplyWithTools(params: Record<string, unknown>) {
        options?.onGenerateToolReply?.(params);
        return {
          type: 'text' as const,
          content: options?.toolReply ?? options?.aiReply ?? DEFAULT_AI_REPLY,
          toolsUsed: options?.toolResults?.map((result) => result.toolName) ?? [],
          toolResults: options?.toolResults ?? [],
        };
      },
    } as any,
    botConfigService,
    {
      async getConfig() {
        return {
          openaiKey: 'test-key',
          elevenlabsKey: '',
          promptBase: options?.configPromptBase ?? 'LEGACY_BASE_PROMPT',
          aiSettings: {
            memoryWindow: 6,
            modelName: 'gpt-4o-mini',
            temperature: 0.4,
            maxCompletionTokens: 180,
          },
          configurations: options?.configConfigurations ?? {},
        };
      },
    } as any,
    {
      async saveMessage(entry: { contactId?: string; role: 'user' | 'assistant'; content: string }) {
        savedMessages = [...savedMessages, { role: entry.role, content: entry.content }];
        return entry;
      },
      async getConversationContext() {
        return {
          messages: savedMessages.map((m) => ({ role: m.role, content: m.content })),
          clientMemory: {
            contactId: 'test-contact',
            name: null,
            objective: null,
            interest: null,
            objections: [],
            status: 'nuevo' as const,
            lastIntent: null,
            notes: null,
            personalData: {},
            updatedAt: null,
            expiresAt: null,
          },
          summary: {
            contactId: 'test-contact',
            summary: null,
            updatedAt: null,
            expiresAt: null,
          },
        };
      },
    } as any,
    {
      resolveConfig() {
        return {};
      },
      buildOpenAITools() {
        return options?.openAiTools ?? [];
      },
    } as any,
    {
      async execute() {
        throw new Error('Tool execution should not be called in this test');
      },
    } as any,
    promptComposerService as any,
  );
}

test('uses a single direct AI reply for a normal message', async () => {
  let aiCalls = 0;
  const service = createService({
    onGenerateSimpleReply: () => {
      aiCalls += 1;
    },
  });

  const result = await service.processIncomingMessage('18095550001', 'hola');

  assert.equal(aiCalls, 1);
  assert.equal(result.source, 'ai');
  assert.equal(result.reply, DEFAULT_AI_REPLY);
});

test('buy-intent messages stay in the direct AI flow and keep hotLead metadata', async () => {
  const service = createService({
    aiReply: 'Dale, Phytoemagry Caps te puede ayudar y te digo ahora mismo cómo pedirlo.',
  });

  const result = await service.processIncomingMessage('18095550007', 'lo quiero');

  assert.equal(result.source, 'ai');
  assert.equal(result.hotLead, true);
  assert.equal(result.decisionIntent, 'compra');
});

test('system prompt includes knowledge blocks in the expected order', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    onGenerateSimpleReply: (params) => {
      capturedParams = params;
    },
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [],
      },
    },
  });

  await service.processIncomingMessage('18095550002', 'hola');

  const systemPrompt = String((capturedParams as { systemPrompt?: string } | null)?.systemPrompt ?? '');
  assert.ok(systemPrompt.includes('[INSTRUCCIONES]'));
  assert.ok(systemPrompt.includes('[PRODUCTOS]'));
  assert.ok(systemPrompt.includes('[EMPRESA]'));
  assert.ok(systemPrompt.indexOf('[INSTRUCCIONES]') < systemPrompt.indexOf('[PRODUCTOS]'));
  assert.ok(systemPrompt.indexOf('[PRODUCTOS]') < systemPrompt.indexOf('[EMPRESA]'));
  assert.match(systemPrompt, /REGLAS BASE DEL SISTEMA/);
  assert.match(systemPrompt, /Interpreta respuestas cortas dominicanas/);
  assert.match(systemPrompt, /primero usa la tool correspondiente/);
});

test('short affirmative replies are enriched with the last assistant message for continuity', async () => {
  let capturedSecondCall: Record<string, unknown> | null = null;
  let callCount = 0;
  const service = createService({
    aiReply: '¿Te gustaría saber más sobre nuestros productos?',
    onGenerateSimpleReply: (params) => {
      callCount += 1;
      if (callCount === 2) capturedSecondCall = params;
    },
  });

  await service.processIncomingMessage('18095550100', 'ubicacion de la tienda');
  await service.processIncomingMessage('18095550100', 'Si');

  const message = String((capturedSecondCall as { message?: string } | null)?.message ?? '');
  assert.match(message, /\[CONTEXTO DE CONTINUIDAD\]/);
  assert.match(message, /Último mensaje del bot: ¿Te gustaría saber más sobre nuestros productos\?/);
  assert.match(message, /no saludes de nuevo/i);
});

test('location requests are classified as interest and repaired when company tool data is ignored', async () => {
  const service = createService({
    openAiTools: [{ type: 'function', function: { name: 'consultar_info_empresa' } }],
    toolReply: '¡Hola! ¿Hay algo más en lo que pueda ayudarte?',
    toolResults: [
      {
        toolName: 'consultar_info_empresa',
        result: {
          companyName: 'Phytoemagry',
          address: 'Higuey, centro, calle Beller N° 9',
          googleMapsLink: 'https://maps.example/demo',
        },
      },
    ],
  });

  const result = await service.processIncomingMessage('18095550101', 'ubicacion de la tienda');

  assert.equal(result.intent, 'interes');
  assert.match(result.reply, /Higuey, centro, calle Beller/);
  assert.match(result.reply, /https:\/\/maps\.example\/demo/);
});

test('canonical configurations suppress legacy promptBase + botConfig prompts', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    onGenerateSimpleReply: (params) => {
      capturedParams = params;
    },
    configPromptBase: 'LEGACY_BASE_SHOULD_NOT_APPEAR',
    botFullPrompt: 'LEGACY_BOT_SHOULD_NOT_APPEAR',
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [],
      },
    },
  });

  await service.processIncomingMessage('18095550011', 'hola');

  const systemPrompt = String((capturedParams as { systemPrompt?: string } | null)?.systemPrompt ?? '');
  assert.match(systemPrompt, /Nombre: Aura/);
  assert.doesNotMatch(systemPrompt, /LEGACY_BASE_SHOULD_NOT_APPEAR/);
  assert.doesNotMatch(systemPrompt, /LEGACY_BOT_SHOULD_NOT_APPEAR/);
});

test('legacy promptBase + botConfig prompts are used when canonical configurations are empty', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    onGenerateSimpleReply: (params) => {
      capturedParams = params;
    },
    configPromptBase: 'LEGACY_BASE_SHOULD_APPEAR',
    botFullPrompt: 'LEGACY_BOT_SHOULD_APPEAR',
    configConfigurations: {},
  });

  await service.processIncomingMessage('18095550012', 'hola');

  const systemPrompt = String((capturedParams as { systemPrompt?: string } | null)?.systemPrompt ?? '');
  assert.match(systemPrompt, /LEGACY_BASE_SHOULD_APPEAR/);
  assert.match(systemPrompt, /LEGACY_BOT_SHOULD_APPEAR/);
});

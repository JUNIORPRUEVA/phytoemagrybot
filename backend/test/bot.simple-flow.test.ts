import assert from 'node:assert/strict';
import test from 'node:test';

import { BotService } from '../src/bot/bot.service';
import { PromptComposerService } from '../src/bot/prompt-composer.service';

const DEFAULT_AI_REPLY = 'Hola, claro. Te ayudo ahora mismo.';

function createService(options?: {
  aiReply?: string;
  aiReplies?: string[];
  toolReply?: string;
  toolResults?: Array<{ toolName: string; result: Record<string, unknown> }>;
  openAiTools?: unknown[];
  onGenerateSimpleReply?: (params: Record<string, unknown>) => void;
  onGenerateToolReply?: (params: Record<string, unknown>) => void;
  configPromptBase?: string;
  botFullPrompt?: string;
  configConfigurations?: Record<string, unknown>;
  hideAssistantFromContext?: boolean;
}) {
  let savedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let simpleReplyCalls = 0;
  let toolReplyCalls = 0;

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
        const reply = options?.aiReplies?.[simpleReplyCalls] ?? options?.aiReply ?? DEFAULT_AI_REPLY;
        simpleReplyCalls += 1;
        options?.onGenerateSimpleReply?.(params);
        return {
          type: 'text' as const,
          content: reply,
        };
      },
      async generateReplyWithTools(params: Record<string, unknown>) {
        const reply = options?.aiReplies?.[toolReplyCalls] ?? options?.toolReply ?? options?.aiReply ?? DEFAULT_AI_REPLY;
        toolReplyCalls += 1;
        options?.onGenerateToolReply?.(params);
        return {
          type: 'text' as const,
          content: reply,
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
        const contextMessages = options?.hideAssistantFromContext
          ? savedMessages.filter((m) => m.role !== 'assistant')
          : savedMessages;
        return {
          messages: contextMessages.map((m) => ({ role: m.role, content: m.content })),
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
      async getLastAssistantMessage() {
        const last = [...savedMessages].reverse().find((m) => m.role === 'assistant');
        return last ? { role: last.role, content: last.content } : null;
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
  assert.match(message, /no saludes/i);
  assert.match(message, /próximo paso lógico/i);
});

test('short affirmative replies inherit product context instead of falling back to generic intent', async () => {
  let capturedSecondCall: Record<string, unknown> | null = null;
  let callCount = 0;
  const service = createService({
    aiReplies: [
      'Tenemos el producto "Phytoemagry", que es un suplemento natural para apoyar la pérdida de peso. ¿Te gustaría probarlo?',
      'Perfecto, te explico el siguiente paso.',
    ],
    onGenerateSimpleReply: (params) => {
      callCount += 1;
      if (callCount === 2) capturedSecondCall = params;
    },
  });

  await service.processIncomingMessage('18095550110', 'Productos');
  const result = await service.processIncomingMessage('18095550110', 'Si');

  const message = String((capturedSecondCall as { message?: string } | null)?.message ?? '');
  assert.match(message, /Intención inferida: compra|Intención inferida: interes/);
  assert.match(message, /Continúa exactamente desde ese ofrecimiento/);
  assert.notEqual(result.intent, 'otro');
  assert.equal(result.action, 'cerrar');
});

test('generic AI reply after an affirmative continuation is repaired into a real next step', async () => {
  const service = createService({
    aiReplies: [
      'Tenemos el producto "Phytoemagry", que es un suplemento natural para apoyar la pérdida de peso. ¿Te gustaría probarlo?',
      '¿Te gustaría saber más sobre las cápsulas para rebajar?',
    ],
  });

  await service.processIncomingMessage('18095550111', 'Productos');
  const result = await service.processIncomingMessage('18095550111', 'Si');

  assert.match(result.reply, /Perfecto, dale/);
  assert.match(result.reply, /seguimos con ese producto/);
  assert.doesNotMatch(result.reply, /Te gustaría saber más sobre las cápsulas/i);
  assert.equal(result.intent, 'compra');
});

test('short replies use last-assistant fallback when recent history is incomplete', async () => {
  let capturedSecondCall: Record<string, unknown> | null = null;
  let callCount = 0;
  const service = createService({
    hideAssistantFromContext: true,
    aiReplies: [
      'Tenemos el producto "Phytoemagry". ¿Te gustaría probarlo?',
      'Perfecto, seguimos.',
    ],
    onGenerateSimpleReply: (params) => {
      callCount += 1;
      if (callCount === 2) capturedSecondCall = params;
    },
  });

  await service.processIncomingMessage('18095550113', 'Productos');
  const result = await service.processIncomingMessage('18095550113', 'Si');

  const message = String((capturedSecondCall as { message?: string } | null)?.message ?? '');
  assert.match(message, /Último mensaje del bot: Tenemos el producto "Phytoemagry"/);
  assert.equal(result.intent, 'compra');
});

test('short negative replies after an offer do not restart or insist', async () => {
  const service = createService({
    aiReplies: [
      'Tenemos el producto "Phytoemagry". ¿Te gustaría probarlo?',
      '¿Te gustaría saber más sobre las cápsulas para rebajar?',
    ],
  });

  await service.processIncomingMessage('18095550112', 'Productos');
  const result = await service.processIncomingMessage('18095550112', 'No');

  assert.match(result.reply, /sin problema/i);
  assert.doesNotMatch(result.reply, /Te gustaría saber más sobre las cápsulas/i);
  assert.equal(result.intent, 'otro');
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

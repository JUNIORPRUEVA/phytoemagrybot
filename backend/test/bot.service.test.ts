import assert from 'node:assert/strict';
import test from 'node:test';

import { BotService } from '../src/bot/bot.service';
import { BotReplyResult } from '../src/bot/bot.types';

function createService(options?: {
  mediaCount?: number;
  lastIntent?: string | null;
  aiReply?: string;
  companyContextText?: string;
  generateReply?: (params: Record<string, unknown>) => { type: 'text' | 'audio'; content: string } | Promise<{ type: 'text' | 'audio'; content: string }>;
  onGenerateReply?: (params: Record<string, unknown>) => void;
}) {
  const savedMessages: Array<{ role: string; content: string }> = [];
  const memoryState = {
    lastIntent: options?.lastIntent ?? null,
  };

  const service = new BotService(
    {
      async generateReply(params: Record<string, unknown>) {
        options?.onGenerateReply?.(params);

        if (options?.generateReply) {
          return options.generateReply(params);
        }

        return {
          type: 'text' as const,
          content: options?.aiReply ?? 'Claro 👌 te ayudo con eso.',
        };
      },
    } as any,
    {
      async getConfig() {
        return {
          promptBase: '',
          promptShort: '',
          promptHuman: '',
          promptSales: '',
        };
      },
      getFullPrompt() {
        return '';
      },
    } as any,
    {
      async buildAgentContext() {
        return options?.companyContextText ?? '';
      },
    } as any,
    {
      async getConfig() {
        return {
          openaiKey: 'test-key',
          elevenlabsKey: '',
          aiSettings: {
            memoryWindow: 6,
            modelName: 'gpt-4o-mini',
            temperature: 0.4,
            maxCompletionTokens: 180,
          },
          botSettings: {
            responseCacheTtlSeconds: 60,
            spamGroupWindowMs: 2000,
            allowAudioReplies: true,
          },
          configurations: {},
        };
      },
    } as any,
    {
      async getMediaByKeyword(_text: string, take = 3) {
        return Array.from({ length: options?.mediaCount ?? 0 }).slice(0, take).map((_, index) => ({
          id: index + 1,
          title: `media-${index + 1}`,
          description: null,
          fileUrl: `https://example.com/${index + 1}.jpg`,
          fileType: 'image',
          createdAt: new Date(),
        }));
      },
    } as any,
    {
      async saveMessage(entry: { role: string; content: string }) {
        savedMessages.push(entry);
        if (entry.role === 'user') {
          const normalized = entry.content.toLowerCase();
          if (normalized.includes('lo quiero')) {
            memoryState.lastIntent = 'HOT';
          } else if (normalized.includes('ok')) {
            memoryState.lastIntent = memoryState.lastIntent === 'HOT' ? 'HOT' : 'cierre';
          } else if (normalized.includes('precio')) {
            memoryState.lastIntent = 'consulta_precio';
          }
        }

        return entry;
      },
      async getConversationContext() {
        return {
          messages: savedMessages.map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content })),
          clientMemory: {
            contactId: 'test-contact',
            name: 'Maria',
            interest: 'te detox',
            lastIntent: memoryState.lastIntent,
            notes: null,
            updatedAt: null,
          },
          summary: {
            contactId: 'test-contact',
            summary: null,
            updatedAt: null,
          },
        };
      },
    } as any,
    {
      store: new Map<string, BotReplyResult>(),
      async get(key: string) {
        return this.store.get(key) ?? null;
      },
      async set(key: string, value: BotReplyResult) {
        this.store.set(key, value);
      },
    } as any,
  );

  return service;
}

test('price message uses ai with a brief answer style', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    mediaCount: 1,
    aiReply: 'Cuesta 1,500 pesos. Si quieres, te digo cómo pedirla.',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });
  const result = await service.processIncomingMessage('18095551234', 'precio');

  assert.equal(result.usedGallery, false);
  assert.equal(result.mediaFiles.length, 0);
  assert.equal(result.source, 'ai');
  assert.equal((capturedParams as { responseStyle?: string } | null)?.responseStyle, 'brief');
  assert.match(result.reply.toLowerCase(), /cuesta|pesos/);
});

test('injects company context as a separate AI input without replacing prompts', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    companyContextText:
      'CONTEXTO_EMPRESA\n\nNo reemplaza el prompt principal.\n\n{"usage_rules_json":{"send_location":"solo_si_cliente_la_pide"}}',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  await service.processIncomingMessage('18095551234', 'donde estan ubicados?');

  assert.match(String((capturedParams as { companyContext?: string } | null)?.companyContext ?? ''), /CONTEXTO_EMPRESA/);
  assert.match(String((capturedParams as { companyContext?: string } | null)?.companyContext ?? ''), /No reemplaza el prompt principal/);
  assert.equal(typeof (capturedParams as { fullPrompt?: string } | null)?.fullPrompt, 'string');
});

test('closing message answers with sales close', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    aiReply: 'Perfecto, te lo dejo listo hoy mismo 👍',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });
  const result = await service.processIncomingMessage('18095551234', 'ok');

  assert.equal(result.intent, 'cierre');
  assert.equal(result.source, 'ai');
  assert.equal((capturedParams as { leadStage?: string } | null)?.leadStage, 'listo_para_comprar');
  assert.equal((capturedParams as { replyObjective?: string } | null)?.replyObjective, 'cerrar_venta');
  assert.match(result.reply.toLowerCase(), /env[ií]o hoy|dejo listo/);
});

test('hot lead message marks the conversation as hot', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    aiReply: 'Dale, te lo dejo listo y te explico como te llega 👍',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });
  const result = await service.processIncomingMessage('18095551234', 'lo quiero');

  assert.equal(result.hotLead, true);
  assert.equal(result.source, 'ai');
  assert.equal((capturedParams as { leadStage?: string } | null)?.leadStage, 'listo_para_comprar');
  assert.equal((capturedParams as { replyObjective?: string } | null)?.replyObjective, 'cerrar_venta');
});

test('doubt message uses direct convincing response', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    aiReply: 'Sí, eso funciona bastante bien; por eso la gente lo sigue pidiendo 👌',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });
  const result = await service.processIncomingMessage('18095551234', 'funciona de verdad?');

  assert.equal(result.intent, 'duda');
  assert.equal(result.source, 'ai');
  assert.equal((capturedParams as { leadStage?: string } | null)?.leadStage, 'dudoso');
  assert.equal((capturedParams as { replyObjective?: string } | null)?.replyObjective, 'resolver_duda');
});

test('repeated message uses cache on second request', async () => {
  const service = createService({ mediaCount: 1 });
  const first = await service.processIncomingMessage('18095551234', 'precio');
  const second = await service.processIncomingMessage('18095551234', 'precio');

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.source, 'cache');
});

test('catalog request returns multiple media when available', async () => {
  const service = createService({ mediaCount: 5 });
  const result = await service.processIncomingMessage('18095551234', 'quiero catálogo');

  assert.equal(result.intent, 'catalogo');
  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 5);
});

test('voice request prefers audio replies', async () => {
  const service = createService();
  const result = await service.processIncomingMessage(
    '18095551234',
    'explicame por voz como funciona',
  );

  assert.equal(result.replyType, 'audio');
});

test('visual request requests more gallery media', async () => {
  const service = createService({ mediaCount: 5 });
  const result = await service.processIncomingMessage(
    '18095551234',
    'mandame fotos y resultados por favor',
  );

  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 5);
});

test('informational request after a hot lead uses AI instead of the hot close', async () => {
  const service = createService({
    mediaCount: 3,
    lastIntent: 'HOT',
    aiReply: 'Claro, te explico un poco como funciona la pastilla y para quien va mejor.',
  });
  const result = await service.processIncomingMessage(
    '18095551234',
    'Antes explicame un poco de la pastilla',
  );

  assert.equal(result.source, 'ai');
  assert.equal(result.hotLead, false);
  assert.equal(result.usedGallery, false);
  assert.match(result.reply.toLowerCase(), /explico|funciona|pastilla/);
});

test('informational request uses detailed response style', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    aiReply: 'Claro, te explico bien. Esta pastilla ayuda a controlar el apetito y normalmente se usa como apoyo junto con buena alimentacion e hidratacion.',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  const result = await service.processIncomingMessage(
    '18095551234',
    'Hablame de la pastilla y dime como funciona',
  );

  assert.equal(result.source, 'ai');
  assert.equal((capturedParams as { responseStyle?: string } | null)?.responseStyle, 'detailed');
  assert.match(result.reply.toLowerCase(), /explico|funciona|pastilla/);
});

test('simulates a curious customer conversation with adaptive guidance', async () => {
  const aiCalls: Record<string, unknown>[] = [];
  const service = createService({
    generateReply: async (params) => {
      aiCalls.push(params);
      const message = String(params.message).toLowerCase();

      if (message.includes('hablame') || message.includes('háblame')) {
        return {
          type: 'text',
          content: 'Mira, esa pastilla te ayuda bastante con el apetito, y por eso mucha gente la usa para arrancar a rebajar.',
        };
      }

      if (message.includes('precio')) {
        return {
          type: 'text',
          content: 'Cuesta 1,500 pesos, y si quieres te digo de una como pedirla.',
        };
      }

      return {
        type: 'text',
        content: 'Claro, dime que te gustaria saber y te explico sin enredo.',
      };
    },
  });

  const first = await service.processIncomingMessage('18095550001', 'hola');
  const second = await service.processIncomingMessage('18095550001', 'hablame de la pastilla');
  const third = await service.processIncomingMessage('18095550001', 'y el precio?');

  assert.equal(first.source, 'ai');
  assert.equal(second.source, 'ai');
  assert.equal(third.source, 'ai');
  assert.equal((aiCalls[0] as { leadStage?: string }).leadStage, 'curioso');
  assert.equal((aiCalls[1] as { responseStyle?: string }).responseStyle, 'detailed');
  assert.equal((aiCalls[1] as { replyObjective?: string }).replyObjective, 'generar_confianza');
  assert.equal((aiCalls[2] as { responseStyle?: string }).responseStyle, 'brief');
  assert.equal((aiCalls[2] as { replyObjective?: string }).replyObjective, 'avanzar_conversacion');
  assert.notEqual(second.reply, third.reply);
  assert.match(second.reply.toLowerCase(), /mira|te ayuda|rebajar/);
  assert.match(third.reply.toLowerCase(), /cuesta|pesos/);
});

test('simulates a doubtful customer conversation without repeating the same line', async () => {
  const aiCalls: Record<string, unknown>[] = [];
  const service = createService({
    generateReply: async (params) => {
      aiCalls.push(params);
      const message = String(params.message).toLowerCase();
      const history = (params.history as Array<{ content: string }> | undefined) ?? [];

      if (history.length > 1 || message.includes('miedo')) {
        return {
          type: 'text',
          content: 'Te entiendo; por eso te hablo claro, esto se vende bastante porque la gente si nota el cambio cuando se lo toma bien.',
        };
      }

      return {
        type: 'text',
        content: 'Sí, funciona bastante bien, por eso es de los que más buscan 👌',
      };
    },
  });

  const first = await service.processIncomingMessage('18095550002', 'eso funciona de verdad?');
  const second = await service.processIncomingMessage('18095550002', 'me da miedo comprar algo que no sirva');

  assert.equal(first.source, 'ai');
  assert.equal(second.source, 'ai');
  assert.equal((aiCalls[0] as { leadStage?: string }).leadStage, 'dudoso');
  assert.equal((aiCalls[0] as { replyObjective?: string }).replyObjective, 'resolver_duda');
  assert.equal((aiCalls[1] as { leadStage?: string }).leadStage, 'dudoso');
  assert.ok((((aiCalls[1] as { history?: unknown[] }).history) ?? []).length >= 2);
  assert.notEqual(first.reply, second.reply);
  assert.match(second.reply.toLowerCase(), /te entiendo|se vende bastante|cambio/);
});

test('simulates a ready-to-buy customer and guides to the sale', async () => {
  const aiCalls: Record<string, unknown>[] = [];
  const service = createService({
    generateReply: async (params) => {
      aiCalls.push(params);
      const message = String(params.message).toLowerCase();

      if (message.includes('lo quiero')) {
        return {
          type: 'text',
          content: 'Dale, te lo dejo listo hoy mismo 👍 si quieres te digo ahora como te lo envio.',
        };
      }

      return {
        type: 'text',
        content: 'Perfecto, eso te puede ayudar bastante; si quieres te explico rapido como pedirlo.',
      };
    },
  });

  const first = await service.processIncomingMessage('18095550003', 'me interesa');
  const second = await service.processIncomingMessage('18095550003', 'lo quiero');

  assert.equal(first.source, 'ai');
  assert.equal(second.source, 'ai');
  assert.equal(second.hotLead, true);
  assert.equal((aiCalls[1] as { leadStage?: string }).leadStage, 'listo_para_comprar');
  assert.equal((aiCalls[1] as { replyObjective?: string }).replyObjective, 'cerrar_venta');
  assert.ok((((aiCalls[1] as { history?: unknown[] }).history) ?? []).length >= 2);
  assert.match(second.reply.toLowerCase(), /te lo dejo listo|te lo envio|como te lo envio/);
});
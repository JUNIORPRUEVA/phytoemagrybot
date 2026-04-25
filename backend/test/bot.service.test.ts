import assert from 'node:assert/strict';
import test from 'node:test';

import { BotService } from '../src/bot/bot.service';
import { BotReplyResult } from '../src/bot/bot.types';

function createService(options?: {
  mediaCount?: number;
  lastIntent?: string | null;
  aiReply?: string;
  classifiedIntent?: string;
  companyContextText?: string;
  companyContextResolver?: (message: string) => string;
  configConfigurations?: Record<string, unknown>;
  botConfig?: {
    promptBase?: string;
    promptShort?: string;
    promptHuman?: string;
    promptSales?: string;
  };
  memoryContext?: {
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    clientMemory?: {
      contactId?: string;
      name?: string | null;
      objective?: 'rebajar' | 'info' | 'comprar' | null;
      interest?: string | null;
      objections?: string[];
      status?: 'nuevo' | 'interesado' | 'cliente';
      lastIntent?: string | null;
      notes?: string | null;
      updatedAt?: Date | null;
      expiresAt?: Date | null;
    };
    summary?: {
      contactId?: string;
      summary?: string | null;
      updatedAt?: Date | null;
      expiresAt?: Date | null;
    };
  };
  generateReply?: (params: Record<string, unknown>) => { type: 'text' | 'audio'; content: string } | Promise<{ type: 'text' | 'audio'; content: string }>;
  classifyIntent?: (params: Record<string, unknown>) => string | Promise<string>;
  onGenerateReply?: (params: Record<string, unknown>) => void;
  onClassifyIntent?: (params: Record<string, unknown>) => void;
}) {
  const savedMessages: Array<{ role: string; content: string }> = [];
  const memoryState = {
    lastIntent: options?.lastIntent ?? null,
  };
  const contactStateStore = new Map<string, Record<string, unknown>>();
  const summaryStore = new Map<string, Record<string, unknown>>();

  const service = new BotService(
    {
      async classifyIntent(params: Record<string, unknown>) {
        options?.onClassifyIntent?.(params);

        if (options?.classifyIntent) {
          return options.classifyIntent(params);
        }

        return options?.classifiedIntent ?? 'curioso';
      },
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
          promptBase: options?.botConfig?.promptBase ?? 'Habla claro y vende con naturalidad.',
          promptShort: options?.botConfig?.promptShort ?? 'Responde con foco comercial.',
          promptHuman: options?.botConfig?.promptHuman ?? 'Tono humano y cercano.',
          promptSales: options?.botConfig?.promptSales ?? 'Cierra suave cuando convenga.',
        };
      },
      getFullPrompt() {
        return '';
      },
    } as any,
    {
      async buildAgentContext() {
        return options?.companyContextText ?? options?.companyContextResolver?.('') ?? 'CONTEXTO_EMPRESA\n\n{"company_name":"Phyto Emagry","phone":"809-555-1234","address":"Santo Domingo"}';
      },
      async buildAgentContextForMessage(message: string) {
        return options?.companyContextResolver?.(message) ?? options?.companyContextText ?? '';
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
          configurations: options?.configConfigurations ?? {
            instructions: {
              identity: {
                assistantName: 'Aura',
                role: 'Asesora comercial',
                objective: 'Convertir conversaciones en pedidos',
                tone: 'Cercana',
              },
              rules: ['Siempre responde con datos reales'],
              salesPrompts: {
                opening: 'Abre con cercania.',
                offer: 'Presenta valor y precio.',
              },
              products: [
                {
                  name: 'Te Detox Premium',
                  category: 'Infusion',
                  summary: 'Ayuda a digestion y bienestar.',
                  price: 'RD$1,500',
                },
              ],
            },
          },
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
        const override = options?.memoryContext;
        const clientMemory = {
          contactId: 'test-contact',
          name: 'Maria',
          objective: null,
          interest: 'te detox',
          objections: [],
          status: 'nuevo' as const,
          lastIntent: memoryState.lastIntent,
          notes: null,
          updatedAt: null,
          expiresAt: null,
          ...(override?.clientMemory ?? {}),
        };
        const summary = {
          contactId: 'test-contact',
          summary: null,
          updatedAt: null,
          expiresAt: null,
          ...(override?.summary ?? {}),
        };

        return {
          messages: override?.messages ?? savedMessages.map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content })),
          clientMemory,
          summary,
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
    {
      contactState: {
        async findUnique({ where }: { where: { contactId: string } }) {
          return contactStateStore.get(where.contactId) ?? null;
        },
        async upsert({ where, create, update }: { where: { contactId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) {
          const next = {
            ...(contactStateStore.get(where.contactId) ?? {}),
            ...(contactStateStore.has(where.contactId) ? update : create),
          };
          contactStateStore.set(where.contactId, next);
          return next;
        },
        async updateMany({ where, data }: { where: { contactId: string }; data: Record<string, unknown> }) {
          const next = {
            ...(contactStateStore.get(where.contactId) ?? {}),
            ...data,
          };
          contactStateStore.set(where.contactId, next);
          return { count: 1 };
        },
      },
      contactConversationSummary: {
        async upsert({ where, create, update }: { where: { contactId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) {
          const next = {
            ...(summaryStore.get(where.contactId) ?? {}),
            ...(summaryStore.has(where.contactId) ? update : create),
          };
          summaryStore.set(where.contactId, next);
          return next;
        },
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

test('always injects the mandatory combined knowledge context before replying', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    companyContextText:
      'CONTEXTO_EMPRESA\n\n{"company_name":"Phyto Emagry","phone":"809-555-1234","address":"Santo Domingo"}',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  await service.processIncomingMessage('18095551234', 'hola');

  const companyContext = String(
    (capturedParams as { companyContext?: string } | null)?.companyContext ?? '',
  );
  assert.match(companyContext, /\[INSTRUCCIONES\]/);
  assert.match(companyContext, /\[PRODUCTOS\]/);
  assert.match(companyContext, /\[EMPRESA\]/);
  assert.match(companyContext, /Te Detox Premium/);
  assert.match(companyContext, /Phyto Emagry/);
});

test('falls back to a resilient sales reply when mandatory knowledge sources are incomplete', async () => {
  const service = createService({
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [],
      },
    },
    companyContextText: '',
  });

  const result = await service.processIncomingMessage('18095551234', 'hola');

  assert.equal(result.source, 'fallback');
  assert.match(result.reply, /PHYTOEMAGRY|capsula|pedirlo/i);
});

test('falls back to a deterministic sales reply when AI generation fails', async () => {
  const service = createService({
    generateReply: async () => {
      throw new Error('OpenAI down');
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'precio');

  assert.equal(result.source, 'fallback');
  assert.equal(result.intent, 'interes');
  assert.match(result.reply, /pasame tu nombre, direccion y telefono|enviartelo hoy/i);
});

test('location question injects only location business context', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    companyContextResolver: () =>
      'CONTEXTO_EMPRESA\n\n{"google_maps_link":"https://www.google.com/maps?q=18.48,-69.93","address":"Santo Domingo"}',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
    generateReply: async (params) => ({
      type: 'text',
      content: String((params.companyContext as string).includes('google_maps_link'))
          ? 'Estamos en Santo Domingo. Te envio la ubicacion por Google Maps: https://www.google.com/maps?q=18.48,-69.93'
          : 'Claro, te digo.',
    }),
  });

  const result = await service.processIncomingMessage('18095551234', 'donde estan ubicados?');

  assert.match(String((capturedParams as { companyContext?: string } | null)?.companyContext ?? ''), /google_maps_link/);
  assert.match(result.reply, /Google Maps|ubicacion|ubicaci[oó]n/i);
});

test('payment question injects bank accounts context', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    companyContextResolver: () =>
      'CONTEXTO_EMPRESA\n\n{"bank_accounts_json":[{"bank":"Banreservas","number":"123"}]}',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
    generateReply: async (params) => ({
      type: 'text',
      content: String((params.companyContext as string).includes('Banreservas'))
          ? 'Puedes pagar por Banreservas cuenta 123 a nombre de la empresa.'
          : 'Claro, te digo como pagar.',
    }),
  });

  const result = await service.processIncomingMessage('18095551234', 'como pago?');

  assert.match(String((capturedParams as { companyContext?: string } | null)?.companyContext ?? ''), /bank_accounts_json/);
  assert.match(result.reply, /Banreservas|cuenta 123/i);
});

test('schedule question injects working hours context', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    companyContextResolver: () =>
      'CONTEXTO_EMPRESA\n\n{"working_hours_json":{"lunes_viernes":"8:00 AM - 6:00 PM"}}',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
    generateReply: async (params) => ({
      type: 'text',
      content: String((params.companyContext as string).includes('lunes_viernes'))
          ? 'Trabajamos de lunes a viernes de 8:00 AM a 6:00 PM.'
          : 'Te comparto el horario.',
    }),
  });

  const result = await service.processIncomingMessage('18095551234', 'a que hora trabajan?');

  assert.match(String((capturedParams as { companyContext?: string } | null)?.companyContext ?? ''), /working_hours_json/);
  assert.match(result.reply, /8:00 AM - 6:00 PM|lunes a viernes/i);
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

test('repeated message still goes through AI and does not use reply cache shortcuts', async () => {
  const service = createService({ mediaCount: 1 });
  const first = await service.processIncomingMessage('18095551234', 'precio');
  const second = await service.processIncomingMessage('18095551234', 'precio');

  assert.equal(first.cached, false);
  assert.equal(second.cached, false);
  assert.equal(second.source, 'ai');
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
  assert.equal((aiCalls[1] as { replyObjective?: string }).replyObjective, 'avanzar_conversacion');
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

test('simulates a cold customer who replies dry without forcing an early close', async () => {
  const aiCalls: Record<string, unknown>[] = [];
  const service = createService({
    generateReply: async (params) => {
      aiCalls.push(params);
      const message = String(params.message).toLowerCase();

      if (message === 'ok') {
        return {
          type: 'text',
          content: 'Mira, lo que más le gusta a la gente es que ayuda a controlar el apetito sin complicarse mucho.',
        };
      }

      return {
        type: 'text',
        content: 'Claro, esta pastilla se usa mucho porque ayuda bastante cuando la meta es rebajar con más control.',
      };
    },
  });

  const first = await service.processIncomingMessage('18095550004', 'de que trata esa pastilla?');
  const second = await service.processIncomingMessage('18095550004', 'ok');

  assert.equal(first.source, 'ai');
  assert.equal(second.source, 'ai');
  assert.equal((aiCalls[1] as { leadStage?: string }).leadStage, 'curioso');
  assert.equal((aiCalls[1] as { replyObjective?: string }).replyObjective, 'avanzar_conversacion');
  assert.notEqual(second.reply.toLowerCase().includes('te lo dejo listo'), true);
  assert.notEqual(first.reply, second.reply);
  assert.match(second.reply.toLowerCase(), /mira|gusta|apetito/);
});

test('simulates a customer comparing with another product', async () => {
  const aiCalls: Record<string, unknown>[] = [];
  const service = createService({
    generateReply: async (params) => {
      aiCalls.push(params);
      return {
        type: 'text',
        content: 'La nuestra gusta bastante porque ayuda a controlar el apetito y se siente mas comoda de llevar en el dia a dia.',
      };
    },
  });

  const result = await service.processIncomingMessage(
    '18095550005',
    'y esa es mejor que la otra que venden?',
  );

  assert.equal(result.source, 'ai');
  assert.equal((aiCalls[0] as { leadStage?: string }).leadStage, 'interesado');
  assert.equal((aiCalls[0] as { replyObjective?: string }).replyObjective, 'avanzar_conversacion');
  assert.match(result.reply.toLowerCase(), /gusta|apetito|comoda/);
});

test('new customer does not inject unnecessary memory context into AI', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    aiReply: 'Claro, dime que te gustaria saber y te ayudo.',
    memoryContext: {
      clientMemory: {
        name: null,
        objective: null,
        interest: null,
        objections: [],
        status: 'nuevo',
        lastIntent: null,
        notes: null,
      },
      summary: {
        summary: null,
      },
    },
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  await service.processIncomingMessage('18095559991', 'hola, quiero informacion');

  const context = String((capturedParams as { context?: string } | null)?.context ?? '');

  assert.match(context, /\[INSTRUCCIONES\]/);
  assert.match(context, /\[PRODUCTOS\]/);
  assert.match(context, /\[EMPRESA\]/);
  assert.doesNotMatch(context, /Resumen de la conversacion/i);
  assert.doesNotMatch(context, /Memoria persistente/i);
});

test('interested customer sends profile memory to AI before answering', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    aiReply: 'Cuesta 1,500 pesos y te puede ayudar bastante si lo que quieres es rebajar.',
    memoryContext: {
      messages: [
        { role: 'user', content: 'quiero rebajar rapido' },
        { role: 'assistant', content: 'Claro, te puede ayudar bastante.' },
      ],
      clientMemory: {
        name: 'Ana',
        objective: 'rebajar',
        interest: 'precio',
        objections: [],
        status: 'interesado',
        lastIntent: 'consulta_precio',
      },
      summary: {
        summary: 'Cliente interesada en rebajar y pendiente de precio.',
      },
    },
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  const result = await service.processIncomingMessage('18095559992', 'y cuanto cuesta?');
  const context = String((capturedParams as { context?: string } | null)?.context ?? '');

  assert.equal(result.source, 'ai');
  assert.match(context, /Cliente interesada en rebajar y pendiente de precio/);
  assert.match(context, /Objetivo principal: rebajar/);
  assert.match(context, /Interes detectado: precio/);
  assert.match(context, /Estado del cliente: interesado/);
});

test('recurrent customer uses summary and history to avoid repeating the same answer', async () => {
  const replies: string[] = [];
  const service = createService({
    memoryContext: {
      messages: [
        { role: 'user', content: 'cuanto cuesta?' },
        { role: 'assistant', content: 'Cuesta 1,500 pesos.' },
        { role: 'user', content: 'y funciona de verdad?' },
      ],
      clientMemory: {
        name: 'Luis',
        objective: 'comprar',
        interest: 'dudas',
        objections: ['tiene dudas sobre resultados'],
        status: 'interesado',
        lastIntent: 'duda',
      },
      summary: {
        summary: 'Cliente recurrente: ya pregunto precio y ahora busca confianza para decidir.',
      },
    },
    generateReply: async (params) => {
      const context = String(params.context ?? '');
      const history = ((params.history as Array<{ content: string }> | undefined) ?? []).map((item) => item.content).join(' | ');

      if (context.includes('ya pregunto precio') && history.includes('Cuesta 1,500 pesos.')) {
        const reply = 'Sí, y justo por eso mucha gente se anima: ya sabes el precio, ahora lo importante es que si ayuda bastante cuando se usa bien.';
        replies.push(reply);
        return { type: 'text', content: reply };
      }

      const fallback = 'Cuesta 1,500 pesos.';
      replies.push(fallback);
      return { type: 'text', content: fallback };
    },
  });

  const result = await service.processIncomingMessage('18095559993', 'pero de verdad sirve?');

  assert.equal(result.source, 'ai');
  assert.match(result.reply.toLowerCase(), /ya sabes el precio|lo importante es que si ayuda/);
  assert.equal(replies[0], result.reply);
  assert.doesNotMatch(result.reply.toLowerCase(), /^cuesta 1,500 pesos\.?$/);
});
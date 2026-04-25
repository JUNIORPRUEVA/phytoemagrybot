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
  generateResponses?: (params: Record<string, unknown>) => Array<{ text: string; videoId?: string; imageId?: string; type?: 'text' | 'audio' }> | Promise<Array<{ text: string; videoId?: string; imageId?: string; type?: 'text' | 'audio' }>>;
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
      async generateResponses(params: Record<string, unknown>) {
        options?.onGenerateReply?.(params);

        if (options?.generateResponses) {
          return options.generateResponses(params);
        }

        if (options?.generateReply) {
          const single = await options.generateReply(params);
          return [{
            text: single.content,
            type: single.type,
          }];
        }

        return [{
          text: options?.aiReply ?? 'Claro 👌 te ayudo con eso.',
          type: 'text' as const,
        }];
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

  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 1);
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

test('uses real company data for location, schedule, and payment questions', async () => {
  const capturedContexts: string[] = [];
  const companyContextText = [
    '[INSTRUCCIONES]',
    'Responder con datos reales.',
    '',
    '[PRODUCTOS]',
    'Te Detox Premium',
    '',
    '[EMPRESA]',
    'EMPRESA:',
    'Nombre: Phyto Emagry',
    'Direccion: Santo Domingo',
    'Google Maps: https://maps.app.goo.gl/demo123',
    '',
    'HORARIO:',
    '- Lunes: 08:00 - 18:00',
    '',
    'CUENTAS:',
    '- Banco: Banreservas | Tipo: Ahorro | Numero: 123456789 | Titular: Empresa Demo',
  ].join('\n');

  const service = createService({
    companyContextText,
    generateReply: (params) => {
      const message = String(params.message ?? '').toLowerCase();
      const context = String(params.companyContext ?? '');
      capturedContexts.push(context);

      if (message.includes('donde estan')) {
        return {
          type: 'text',
          content: context.includes('Santo Domingo')
            ? 'Estamos en Santo Domingo. Ubicacion: https://maps.app.goo.gl/demo123'
            : 'No tengo ubicacion.',
        };
      }

      if (message.includes('horario')) {
        return {
          type: 'text',
          content: context.includes('08:00 - 18:00')
            ? 'Nuestro horario es de 08:00 a 18:00 los lunes.'
            : 'No tengo horario.',
        };
      }

      if (message.includes('como pago')) {
        return {
          type: 'text',
          content: context.includes('Banreservas')
            ? 'Puedes pagar por Banreservas, cuenta 123456789.'
            : 'No tengo cuentas.',
        };
      }

      return {
        type: 'text',
        content: 'Claro, te ayudo con eso.',
      };
    },
  });

  const locationReply = await service.processIncomingMessage('18095551234', 'donde estan');
  const scheduleReply = await service.processIncomingMessage('18095551234', 'cual es su horario');
  const paymentReply = await service.processIncomingMessage('18095551234', 'como pago');

  assert.match(locationReply.reply, /Santo Domingo/);
  assert.match(locationReply.reply, /maps\.app\.goo\.gl/);
  assert.match(scheduleReply.reply, /08:00 a 18:00/);
  assert.match(paymentReply.reply, /Banreservas/);
  assert.match(paymentReply.reply, /123456789/);

  for (const context of capturedContexts) {
    assert.match(context, /Nombre: Phyto Emagry/);
    assert.match(context, /HORARIO:/);
    assert.match(context, /CUENTAS:/);
  }
});

test('keeps full product catalog and highlights relevant products separately', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'detox-1',
            titulo: 'Te Detox Premium',
            descripcion_corta: 'Ayuda a digestion y bienestar.',
            descripcion_completa: 'Infusion herbal para apoyar digestion y desinflamar.',
            precio: 1500,
            precio_minimo: 1300,
            imagenes: ['https://example.com/detox-1.jpg'],
            videos: ['https://example.com/detox-1.mp4'],
            activo: true,
          },
          {
            id: 'cafe-1',
            titulo: 'Cafe Slim',
            descripcion_corta: 'Cafe funcional para energia.',
            descripcion_completa: 'Cafe pensado para apoyar control de apetito y enfoque.',
            precio: 1750,
            precio_minimo: 1500,
            imagenes: ['https://example.com/cafe-1.jpg'],
            videos: [],
            activo: true,
          },
        ],
      },
    },
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  await service.processIncomingMessage('18095551234', 'quiero ver foto del cafe slim');

  const companyContext = String(
    (capturedParams as { companyContext?: string } | null)?.companyContext ?? '',
  );

  assert.match(companyContext, /\[PRODUCTOS\]/);
  assert.match(companyContext, /Te Detox Premium/);
  assert.match(companyContext, /Cafe Slim/);
  assert.match(companyContext, /\[PRODUCTOS_RELEVANTES\]/);
});

test('uses AI with available context when mandatory knowledge sources are incomplete', async () => {
  let capturedParams: Record<string, unknown> | null = null;
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
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'hola');

  assert.equal(result.source, 'ai');
  assert.match(
    String((capturedParams as { companyContext?: string } | null)?.companyContext ?? ''),
    /\[INSTRUCCIONES\]|Eres un asistente de ventas por WhatsApp\./,
  );
});

test('uses AI with partial context when some knowledge sources exist', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
          role: 'Asesora comercial',
        },
        products: [],
      },
    },
    companyContextText:
      'CONTEXTO_EMPRESA\n\n{"company_name":"Phyto Emagry","phone":"809-555-1234"}',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'hola');

  const companyContext = String(
    (capturedParams as { companyContext?: string } | null)?.companyContext ?? '',
  );

  assert.equal(result.source, 'ai');
  assert.match(companyContext, /\[INSTRUCCIONES\]/);
  assert.match(companyContext, /^\[PRODUCTOS\]$/m);
  assert.match(companyContext, /\[EMPRESA\]/);
});

test('mandatory knowledge context always includes instructions products and company in order', async () => {
  let capturedParams: Record<string, unknown> | null = null;
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
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  await service.processIncomingMessage('18095551234', 'hola');

  const companyContext = String(
    (capturedParams as { companyContext?: string } | null)?.companyContext ?? '',
  );

  assert.match(companyContext, /^\[INSTRUCCIONES\]/m);
  assert.match(companyContext, /^\[PRODUCTOS\]/m);
  assert.match(companyContext, /^\[EMPRESA\]/m);
  assert.ok(
    companyContext.indexOf('[INSTRUCCIONES]') < companyContext.indexOf('[PRODUCTOS]') &&
    companyContext.indexOf('[PRODUCTOS]') < companyContext.indexOf('[EMPRESA]'),
  );
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
  assert.notEqual(second.source, 'cache');
  assert.notEqual(second.reply, first.reply);
});

test('catalog request limits outgoing images to avoid saturating the client', async () => {
  const service = createService({ mediaCount: 5 });
  const result = await service.processIncomingMessage('18095551234', 'quiero catálogo');

  assert.equal(result.intent, 'catalogo');
  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 2);
});

test('voice request by text still stays as text', async () => {
  const service = createService();
  const result = await service.processIncomingMessage(
    '18095551234',
    'explicame por voz como funciona',
  );

  assert.equal(result.replyType, 'text');
});

test('short price text always stays as text reply', async () => {
  const service = createService({
    generateReply: async () => ({
      type: 'audio',
      content: 'Cuesta RD$1,500 y te lo puedo dejar listo hoy mismo.',
    }),
  });

  const result = await service.processIncomingMessage('18095551234', 'precio');

  assert.equal(result.replyType, 'text');
});

test('long inbound audio prefers audio reply', async () => {
  const service = createService({
    generateReply: async () => ({
      type: 'text',
      content: 'Claro, te explico como funciona paso por paso, que beneficios suele notar la gente y como se usa para sacarle mejor resultado sin complicarte.',
    }),
  });

  const result = await service.processIncomingMessage(
    '18095551234',
    'quiero saber bien como funciona y si de verdad ayuda a rebajar porque tengo varias dudas antes de decidirme',
    {
      messageType: 'audio',
      transcript: 'quiero saber bien como funciona y si de verdad ayuda a rebajar porque tengo varias dudas antes de decidirme',
    },
  );

  assert.equal(result.replyType, 'audio');
});

test('price intent overrides long inbound audio and stays text', async () => {
  const service = createService({
    generateReply: async () => ({
      type: 'audio',
      content: 'Cuesta RD$1,500 y te llega hoy si lo quieres pedir.',
    }),
  });

  const result = await service.processIncomingMessage(
    '18095551234',
    'cuanto vale exactamente porque quiero saber el precio antes de comprar',
    {
      messageType: 'audio',
      transcript: 'cuanto vale exactamente porque quiero saber el precio antes de comprar y necesito ese dato ahora mismo',
    },
  );

  assert.equal(result.replyType, 'text');
});

test('purchase intent overrides long inbound audio and stays text', async () => {
  const service = createService({
    generateReply: async () => ({
      type: 'audio',
      content: 'Perfecto, te lo dejo listo ahora mismo para cerrar el pedido.',
    }),
  });

  const result = await service.processIncomingMessage(
    '18095551234',
    'me interesa comprarlo y quiero pedirlo hoy mismo',
    {
      messageType: 'audio',
      transcript: 'me interesa comprarlo y quiero pedirlo hoy mismo pero primero dime como seguimos con el pedido por favor',
    },
  );

  assert.equal(result.replyType, 'text');
});

test('explanation intent uses audio only when the answer is long enough', async () => {
  const service = createService({
    generateReply: async () => ({
      type: 'text',
      content: 'Claro, te explico paso por paso como funciona, que beneficios suele notar la gente, como se usa mejor y por que conviene seguirlo bien para que realmente veas resultado.',
    }),
  });

  const result = await service.processIncomingMessage(
    '18095551234',
    'explicame como funciona',
    {
      messageType: 'audio',
      transcript: 'explicame como funciona porque quiero entenderlo completo antes de tomar una decision y necesito la explicacion completa',
    },
  );

  assert.equal(result.replyType, 'audio');
});

test('explanation by text stays text even with a detailed answer', async () => {
  const service = createService({
    generateReply: async () => ({
      type: 'audio',
      content: 'Claro, te explico paso por paso como funciona, que beneficios suele notar la gente, como se usa mejor y por que conviene seguirlo bien para que realmente veas resultado.',
    }),
  });

  const result = await service.processIncomingMessage('18095551234', 'que es exactamente este producto');

  assert.equal(result.replyType, 'text');
});

test('visual request limits outgoing images to two items', async () => {
  const service = createService({ mediaCount: 5 });
  const result = await service.processIncomingMessage(
    '18095551234',
    'mandame fotos y resultados por favor',
  );

  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 2);
});

test('image request uses product images before gallery results', async () => {
  const service = createService({
    mediaCount: 5,
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'detox-1',
            titulo: 'Te Detox Premium',
            descripcion_corta: 'Ayuda a digestion y bienestar.',
            descripcion_completa: 'Infusion herbal para apoyar digestion y desinflamar.',
            precio: 1500,
            precio_minimo: 1300,
            imagenes: [
              'https://example.com/product-detox-1.jpg',
              'https://example.com/product-detox-2.jpg',
              'https://example.com/product-detox-3.jpg',
            ],
            videos: ['https://example.com/product-detox.mp4'],
            activo: true,
          },
        ],
      },
    },
  });

  const result = await service.processIncomingMessage(
    '18095551234',
    'tienes fotos del te detox?',
  );

  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 2);
  assert.equal(result.mediaFiles[0]?.fileUrl, 'https://example.com/product-detox-1.jpg');
  assert.equal(result.mediaFiles[1]?.fileUrl, 'https://example.com/product-detox-2.jpg');
});

test('generic image request sends images and does not say it has none', async () => {
  const service = createService({
    mediaCount: 0,
    aiReply: 'Claro, mira 👇',
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'detox-1',
            titulo: 'Te Detox Premium',
            descripcion_corta: 'Ayuda a digestion y bienestar.',
            descripcion_completa: 'Infusion herbal para apoyar digestion y desinflamar.',
            precio: 1500,
            precio_minimo: 1300,
            imagenes: [
              'https://example.com/product-detox-1.jpg',
              'https://example.com/product-detox-2.jpg',
            ],
            videos: ['https://example.com/product-detox.mp4'],
            activo: true,
          },
        ],
      },
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'tienes fotos?');

  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 2);
  assert.equal(result.mediaFiles[0]?.fileType, 'image');
  assert.doesNotMatch(result.reply.toLowerCase(), /no tengo/);
});

test('does not repeat images that were already sent to the same contact', async () => {
  const service = createService({
    mediaCount: 0,
    aiReply: 'Claro, mira 👇',
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'detox-1',
            titulo: 'Te Detox Premium',
            descripcion_corta: 'Ayuda a digestion y bienestar.',
            descripcion_completa: 'Infusion herbal para apoyar digestion y desinflamar.',
            precio: 1500,
            precio_minimo: 1300,
            imagenes: [
              'https://example.com/product-detox-1.jpg',
              'https://example.com/product-detox-2.jpg',
              'https://example.com/product-detox-3.jpg',
            ],
            videos: [],
            activo: true,
          },
        ],
      },
    },
  });

  const first = await service.processIncomingMessage('18095551234', 'tienes fotos?');
  const second = await service.processIncomingMessage('18095551234', 'tienes fotos?');

  assert.equal(first.mediaFiles.length, 2);
  assert.deepEqual(
    first.mediaFiles.map((file) => file.fileUrl),
    [
      'https://example.com/product-detox-1.jpg',
      'https://example.com/product-detox-2.jpg',
    ],
  );
  assert.equal(second.mediaFiles.length, 0);
  assert.notEqual(second.reply, first.reply);
});

test('video request uses product videos when available', async () => {
  const service = createService({
    mediaCount: 5,
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'detox-1',
            titulo: 'Te Detox Premium',
            descripcion_corta: 'Ayuda a digestion y bienestar.',
            descripcion_completa: 'Infusion herbal para apoyar digestion y desinflamar.',
            precio: 1500,
            precio_minimo: 1300,
            imagenes: ['https://example.com/product-detox-1.jpg'],
            videos: ['https://example.com/product-detox.mp4'],
            activo: true,
          },
        ],
      },
    },
  });

  const result = await service.processIncomingMessage(
    '18095551234',
    'mandame un video del te detox',
  );

  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 1);
  assert.equal(result.mediaFiles[0]?.fileType, 'video');
  assert.equal(result.mediaFiles[0]?.fileUrl, 'https://example.com/product-detox.mp4');
});

test('generic video request sends a product video when available', async () => {
  const service = createService({
    mediaCount: 0,
    aiReply: 'Claro, te lo mando ahora.',
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'detox-1',
            titulo: 'Te Detox Premium',
            descripcion_corta: 'Ayuda a digestion y bienestar.',
            descripcion_completa: 'Infusion herbal para apoyar digestion y desinflamar.',
            precio: 1500,
            precio_minimo: 1300,
            imagenes: ['https://example.com/product-detox-1.jpg'],
            videos: ['https://example.com/product-detox.mp4'],
            activo: true,
          },
        ],
      },
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'tienes video?');

  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 1);
  assert.equal(result.mediaFiles[0]?.fileType, 'video');
});

test('sales response attaches one product image when it helps sell', async () => {
  const service = createService({
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'detox-1',
            titulo: 'Te Detox Premium',
            descripcion_corta: 'Ayuda a digestion y bienestar.',
            descripcion_completa: 'Infusion herbal para apoyar digestion y desinflamar.',
            precio: 1500,
            precio_minimo: 1300,
            imagenes: ['https://example.com/product-detox-1.jpg'],
            videos: [],
            activo: true,
          },
        ],
      },
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'precio del te detox');

  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 1);
  assert.equal(result.mediaFiles[0]?.fileType, 'image');
});

test('generic price question responds with price and sends one image if available', async () => {
  const service = createService({
    aiReply: 'Cuesta 1,500 pesos y te puede ayudar bastante si quieres rebajar.',
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'detox-1',
            titulo: 'Te Detox Premium',
            descripcion_corta: 'Ayuda a digestion y bienestar.',
            descripcion_completa: 'Infusion herbal para apoyar digestion y desinflamar.',
            precio: 1500,
            precio_minimo: 1300,
            imagenes: ['https://example.com/product-detox-1.jpg'],
            videos: [],
            activo: true,
          },
        ],
      },
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'precio?');

  assert.match(result.reply.toLowerCase(), /cuesta|pesos|precio/);
  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 1);
  assert.equal(result.mediaFiles[0]?.fileType, 'image');
});

test('product curiosity sends an image automatically when catalog data exists', async () => {
  const service = createService({
    aiReply: 'Claro, esa pastilla ayuda bastante con el apetito. Te gustaria pedirla?',
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'pastilla-1',
            titulo: 'Pastilla Slim',
            descripcion_corta: 'Ayuda a controlar el apetito.',
            descripcion_completa: 'Producto pensado para apoyar el control de apetito y la rutina diaria.',
            precio: 1600,
            precio_minimo: 1400,
            imagenes: ['https://example.com/pastilla-1.jpg'],
            videos: [],
            activo: true,
          },
        ],
      },
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'hablame de la pastilla');

  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 1);
  assert.equal(result.mediaFiles[0]?.fileType, 'image');
});

test('logs the loaded products for traceability', async () => {
  const originalConsoleLog = console.log;
  const capturedLogs: string[] = [];
  console.log = (...args: unknown[]) => {
    capturedLogs.push(args.map((arg) => String(typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };

  try {
    const service = createService({
      configConfigurations: {
        instructions: {
          identity: {
            assistantName: 'Aura',
          },
          products: [
            {
              id: 'detox-1',
              titulo: 'Te Detox Premium',
              descripcion_corta: 'Ayuda a digestion y bienestar.',
              descripcion_completa: 'Infusion herbal para apoyar digestion y desinflamar.',
              precio: 1500,
              precio_minimo: 1300,
              imagenes: ['https://example.com/product-detox-1.jpg'],
              videos: ['https://example.com/product-detox.mp4'],
              activo: true,
            },
          ],
        },
      },
    });

    await service.processIncomingMessage('18095551234', 'tienes fotos?');
  } finally {
    console.log = originalConsoleLog;
  }

  const joined = capturedLogs.join('\n');
  assert.match(joined, /PRODUCTOS:/);
  assert.match(joined, /Te Detox Premium/);
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

test('regenerates when AI returns a duplicated text already sent to the contact', async () => {
  const capturedContexts: string[] = [];
  const capturedRegenerationInstructions: string[] = [];
  let attempts = 0;
  const service = createService({
    memoryContext: {
      messages: [
        { role: 'user', content: 'precio?' },
        { role: 'assistant', content: 'Cuesta 1,500 pesos.' },
      ],
    },
    generateReply: async (params) => {
      capturedContexts.push(String(params.context ?? ''));
      capturedRegenerationInstructions.push(String(params.regenerationInstruction ?? ''));
      attempts += 1;

      if (attempts === 1) {
        return { type: 'text', content: 'Cuesta 1,500 pesos.' };
      }

      return {
        type: 'text',
        content: 'Cuesta 1,500 pesos, y si quieres te explico ahora mismo como pedirlo.',
      };
    },
  });

  const result = await service.processIncomingMessage('18095559994', 'precio?');

  assert.equal(attempts, 2);
  assert.equal(result.source, 'ai');
  assert.notEqual(result.reply, 'Cuesta 1,500 pesos.');
  assert.match(capturedContexts[0] ?? '', /Textos ya enviados, no los repitas exactos/i);
  assert.match(capturedRegenerationInstructions[1] ?? '', /No repitas el mismo contenido, responde diferente/i);
});

test('does not resend the same product video twice and falls back to a new question', async () => {
  const service = createService({
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'detox-1',
            titulo: 'Te Detox Premium',
            descripcion_corta: 'Ayuda a digestion y bienestar.',
            descripcion_completa: 'Infusion herbal para apoyar digestion y desinflamar.',
            precio: 1500,
            precio_minimo: 1300,
            imagenes: ['https://example.com/product-detox-1.jpg'],
            videos: ['https://example.com/product-detox.mp4'],
            activo: true,
          },
        ],
      },
    },
    generateReply: async () => ({
      type: 'text',
      content: 'Claro, te mando el video ahora.',
    }),
  });

  const first = await service.processIncomingMessage('18095559995', 'mandame el video');
  const second = await service.processIncomingMessage('18095559995', 'mandame el video otra vez');

  assert.equal(first.mediaFiles.length, 1);
  assert.equal(first.mediaFiles[0]?.fileUrl, 'https://example.com/product-detox.mp4');
  assert.equal(second.mediaFiles.length, 0);
  assert.equal(second.source, 'fallback');
  assert.match(second.reply, /\?/);
});

test('respects media cooldown even when there is a new image available', async () => {
  const service = createService({
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'detox-1',
            titulo: 'Te Detox Premium',
            descripcion_corta: 'Ayuda a digestion y bienestar.',
            descripcion_completa: 'Infusion herbal para apoyar digestion y desinflamar.',
            precio: 1500,
            precio_minimo: 1300,
            imagenes: [
              'https://example.com/product-detox-1.jpg',
              'https://example.com/product-detox-2.jpg',
            ],
            videos: [],
            activo: true,
          },
        ],
      },
    },
    generateResponses: async () => ([
      {
        text: 'Te dejo una referencia para que lo veas mejor.',
      },
      {
        text: 'Mira esta imagen y me dices que te parece.',
      },
    ]),
  });

  const first = await service.processIncomingMessage('18095559997', 'mandame una foto');
  const second = await service.processIncomingMessage('18095559997', 'mandame otra foto');

  assert.equal(first.mediaFiles.length > 0, true);
  assert.equal(second.mediaFiles.length, 0);
  assert.notEqual(second.reply, first.reply);
});

test('uses a dynamic human fallback instead of a fixed bot configuration error', async () => {
  const service = createService({
    generateReply: async () => {
      throw new Error('OpenAI unavailable');
    },
  });

  const result = await service.processIncomingMessage('18095559996', 'hola');

  assert.equal(result.source, 'fallback');
  assert.doesNotMatch(result.reply, /Configuracion incompleta del bot/i);
  assert.match(result.reply, /momentico|cargando/i);
});

test('hello thanks k tal conversation stays varied and does not repeat media', async () => {
  const replies: string[] = [];
  const service = createService({
    generateResponses: async (params) => {
      const message = String(params.message ?? '').toLowerCase();

      if (message.includes('hola')) {
        return [
          { text: 'Hola, dime con qué te ayudo.', type: 'text' },
          { text: 'Hey, cuéntame qué quieres saber.', type: 'text' },
        ];
      }

      if (message.includes('gracias')) {
        return [
          { text: 'Con gusto, aquí sigo por si te ayudo con algo más.', type: 'text' },
          { text: 'A la orden, si quieres te aclaro cualquier otra duda.', type: 'text' },
        ];
      }

      return [
        { text: 'Todo bien por aquí, dime qué quieres resolver ahora.', type: 'text' },
        { text: 'Aquí tranquilo, si quieres seguimos y te ayudo rápido.', type: 'text' },
      ];
    },
  });

  replies.push((await service.processIncomingMessage('18095559998', 'Hola')).reply);
  replies.push((await service.processIncomingMessage('18095559998', 'Gracias')).reply);
  const third = await service.processIncomingMessage('18095559998', 'K tal');
  replies.push(third.reply);

  assert.equal(new Set(replies).size, 3);
  assert.equal(third.mediaFiles.length, 0);
});
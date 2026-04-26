import assert from 'node:assert/strict';
import test from 'node:test';

import { BotService } from '../src/bot/bot.service';
import { BotReplyResult } from '../src/bot/bot.types';
import { DEFAULT_COMPANY_CONTEXT } from '../src/company-context/company-context.types';

function createService(options?: {
  mediaCount?: number;
  lastIntent?: string | null;
  aiReply?: string;
  classifiedIntent?: string;
  companyContextText?: string;
  companyContextData?: Record<string, unknown>;
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
  onMediaLookup?: (text: string, take: number) => void;
}) {
  const savedMessagesByContact = new Map<string, Array<{ role: string; content: string }>>();
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
      async getContext() {
        return {
          id: 1,
          ...DEFAULT_COMPANY_CONTEXT,
          createdAt: new Date('2026-04-24T00:00:00.000Z'),
          updatedAt: new Date('2026-04-24T00:00:00.000Z'),
          ...(options?.companyContextData ?? {}),
        };
      },
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
        options?.onMediaLookup?.(_text, take);
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
      async saveMessage(entry: { contactId?: string; role: string; content: string }) {
        const contactId = String(entry.contactId ?? 'test-contact');
        const contactMessages = savedMessagesByContact.get(contactId) ?? [];
        contactMessages.push({ role: entry.role, content: entry.content });
        savedMessagesByContact.set(contactId, contactMessages);
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
      async getConversationContext(contactId?: string) {
        const override = options?.memoryContext;
        const storedMessages = savedMessagesByContact.get(String(contactId ?? 'test-contact')) ?? [];
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
          messages: override?.messages ?? storedMessages.map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content })),
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
      async setIfAbsent(key: string, value: BotReplyResult) {
        if (this.store.has(key)) {
          return false;
        }
        this.store.set(key, value);
        return true;
      },
      async del(key: string) {
        this.store.delete(key);
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

function getGreetingDayKey(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santo_Domingo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function findGreetingKey(store: Map<string, unknown>, contactId: string): string | null {
  const prefix = `greeted:${contactId}:`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      return key;
    }
  }
  return null;
}

test('price message responds immediately without running AI', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    mediaCount: 1,
    aiReply: 'No deberia usarse.',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });
  const result = await service.processIncomingMessage('18095551234', 'precio');

  assert.equal(result.usedGallery, false);
  assert.equal(result.mediaFiles.length, 0);
  assert.equal(result.source, 'hardcode');
  assert.equal(capturedParams, null);
  assert.match(result.reply.toLowerCase(), /cuesta|precio/);
});

test('location questions use company rule override without running AI', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    companyContextData: {
      companyName: 'Phyto Emagry',
      address: 'Santo Domingo',
      googleMapsLink: 'https://maps.app.goo.gl/demo123',
    },
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'donde estan ubicados?');

  assert.equal(result.source, 'hardcode');
  assert.equal(capturedParams, null);
  assert.match(result.reply, /Santo Domingo/);
  assert.match(result.reply, /maps\.app\.goo\.gl/);
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

  await service.processIncomingMessage('18095551234', 'quiero informacion del Te Detox Premium');

  const companyContext = String(
    (capturedParams as { companyContext?: string } | null)?.companyContext ?? '',
  );
  assert.match(companyContext, /\[INSTRUCCIONES\]/);
  assert.match(companyContext, /\[PRODUCTO_RELEVANTE\]/);
  assert.match(companyContext, /\[EMPRESA\]/);
  assert.match(companyContext, /Te Detox Premium/);
  assert.match(companyContext, /Phyto Emagry/);
  assert.ok(companyContext.length <= 2000);
});

test('uses real company data for location, schedule, and payment questions without AI', async () => {
  let aiCalls = 0;
  const service = createService({
    companyContextData: {
      companyName: 'Phyto Emagry',
      address: 'Santo Domingo',
      googleMapsLink: 'https://maps.app.goo.gl/demo123',
      workingHoursJson: [{ day: 'lunes', open: true, from: '08:00', to: '18:00' }],
      bankAccountsJson: [{
        bank: 'Banreservas',
        accountType: 'Ahorro',
        number: '123456789',
        holder: 'Empresa Demo',
        image: '',
      }],
    },
    onGenerateReply: () => {
      aiCalls += 1;
    },
  });

  const locationReply = await service.processIncomingMessage('18095551234', 'donde estan');
  const scheduleReply = await service.processIncomingMessage('18095551234', 'cual es su horario');
  const paymentReply = await service.processIncomingMessage('18095551234', 'como pago');

  assert.equal(aiCalls, 0);
  assert.match(locationReply.reply, /Santo Domingo/);
  assert.match(locationReply.reply, /maps\.app\.goo\.gl/);
  assert.match(scheduleReply.reply, /08:00|18:00/);
  assert.match(paymentReply.reply, /Banreservas/);
  assert.match(paymentReply.reply, /123456789/);
});

test('company rule engine blocks sales outside business hours before AI generation', async () => {
  let aiCalls = 0;
  const service = createService({
    companyContextData: {
      workingHoursJson: [
        ...['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'].map((day) => ({
          day,
          open: true,
          from: '08:00',
          to: '18:00',
        })),
      ],
    },
    generateReply: async () => {
      aiCalls += 1;
      return {
        type: 'text',
        content: 'Te lo envio hoy mismo.',
      };
    },
  });

  const realDateNow = Date.now;
  Date.now = () => new Date('2026-04-24T23:30:00.000Z').getTime();

  try {
    const result = await service.processIncomingMessage('18095558888', 'quiero comprarlo ahora');

    assert.equal(aiCalls, 0);
    assert.equal(result.source, 'fallback');
    assert.match(result.reply, /fuera de horario/i);
  } finally {
    Date.now = realDateNow;
  }
});

test('company rule engine overrides location replies with real company data', async () => {
  let aiCalls = 0;
  const service = createService({
    companyContextData: {
      companyName: 'Phyto Emagry',
      address: 'Av. Independencia, Santo Domingo',
      googleMapsLink: 'https://maps.app.goo.gl/phyto-real',
    },
    generateReply: async () => {
      aiCalls += 1;
      return {
        type: 'text',
        content: 'Estamos por ahi, luego te mando ubicacion.',
      };
    },
  });

  const result = await service.processIncomingMessage('18095557777', 'donde estan ubicados?');

  assert.equal(aiCalls, 0);
  assert.match(result.reply, /Phyto Emagry/);
  assert.match(result.reply, /Av\. Independencia, Santo Domingo/);
  assert.match(result.reply, /maps\.app\.goo\.gl\/phyto-real/);
});

test('company rule engine uses real company phone and name for contact requests', async () => {
  let aiCalls = 0;
  const service = createService({
    companyContextData: {
      companyName: 'Phyto Emagry',
      phone: '809-555-1234',
      whatsapp: '+18095551234',
    },
    generateReply: async () => {
      aiCalls += 1;
      return {
        type: 'text',
        content: 'Escribeme luego y te paso el numero.',
      };
    },
  });

  const result = await service.processIncomingMessage('18095551111', 'cual es su telefono?');

  assert.equal(aiCalls, 0);
  assert.match(result.reply, /Phyto Emagry/);
  assert.match(result.reply, /809-555-1234/);
  assert.match(result.reply, /18095551234|\+18095551234/);
});

test('company rule engine injects mandatory catalog media instruction before AI reply', async () => {
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
            imagenes: ['https://example.com/product-detox-1.jpg'],
            videos: [],
            activo: true,
          },
        ],
      },
    },
    onGenerateReply: (params) => {
      capturedParams = params;
    },
    generateResponses: async () => ([
      {
        text: 'Claro, te muestro una referencia.',
        type: 'text',
      },
      {
        text: 'Te mando una foto para que lo veas mejor.',
        type: 'text',
      },
    ]),
  });

  const result = await service.processIncomingMessage('18095556666', 'mandame una foto');
  const context = String((capturedParams as { context?: string } | null)?.context ?? '');

  assert.match(context, /\[COMPANY_RULE_ENGINE\]/);
  assert.match(context, /No respondas solo con texto si existe media disponible/i);
  assert.equal(result.mediaFiles.length > 0, true);
});

test('company rule engine answers honestly when photos are requested but no real media exists', async () => {
  const service = createService({
    companyContextData: {
      companyName: 'Phyto Emagry',
      whatsapp: '+18095551234',
    },
    generateResponses: async () => ([
      {
        text: 'Claro, te envio fotos ahora mismo.',
        type: 'text',
      },
    ]),
  });

  const result = await service.processIncomingMessage('18095552222', 'enviame fotos');

  assert.equal(result.mediaFiles.length, 0);
  assert.equal(result.source, 'fallback');
  assert.match(result.reply, /Phyto Emagry/);
  assert.match(result.reply, /no tengo fotos cargadas/i);
  assert.doesNotMatch(result.reply, /no puedo enviar fotos/i);
});

test('company rule engine full conversation keeps business rules ahead of AI', async () => {
  const service = createService({
    companyContextData: {
      companyName: 'Phyto Emagry',
      address: 'Av. Independencia, Santo Domingo',
      googleMapsLink: 'https://maps.app.goo.gl/phyto-real',
      phone: '809-555-1234',
      whatsapp: '+18095551234',
      workingHoursJson: [
        {
          day: 'viernes',
          open: true,
          from: '08:00',
          to: '18:00',
        },
      ],
    },
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
    generateResponses: async () => ([
      {
        text: 'Te lo envio hoy mismo y estamos donde sea.',
        type: 'text',
      },
      {
        text: 'Claro, te explico rapido.',
        type: 'text',
      },
    ]),
  });

  const realDateNow = Date.now;
  Date.now = () => new Date('2026-04-25T01:30:00.000Z').getTime();

  try {
    const afterHours = await service.processIncomingMessage('18095553333', 'puedes enviarlo ahora?');
    const photos = await service.processIncomingMessage('18095553333', 'enviame fotos');
    const location = await service.processIncomingMessage('18095553333', 'donde estan ubicados?');
    const buyAttempt = await service.processIncomingMessage('18095553333', 'quiero comprarlo ahora');

    assert.match(afterHours.reply, /fuera de horario/i);
    assert.equal(photos.mediaFiles.length > 0, true);
    assert.match(location.reply, /Phyto Emagry/);
    assert.match(location.reply, /Av\. Independencia, Santo Domingo/);
    assert.match(location.reply, /maps\.app\.goo\.gl\/phyto-real/);
    assert.match(buyAttempt.reply, /fuera de horario/i);
  } finally {
    Date.now = realDateNow;
  }
});

test('AI context includes only the relevant product (not the full catalog)', async () => {
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

  assert.match(companyContext, /\[PRODUCTO_RELEVANTE\]/);
  assert.match(companyContext, /Cafe Slim/);
  assert.doesNotMatch(companyContext, /Te Detox Premium/);
  assert.ok(companyContext.length <= 2000);
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

  const result = await service.processIncomingMessage('18095551234', 'quiero informacion');

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

  const result = await service.processIncomingMessage('18095551234', 'quiero informacion');

  const companyContext = String(
    (capturedParams as { companyContext?: string } | null)?.companyContext ?? '',
  );

  assert.equal(result.source, 'ai');
  assert.match(companyContext, /\[INSTRUCCIONES\]/);
  assert.match(companyContext, /\[EMPRESA\]/);
  assert.ok(companyContext.length <= 2000);
});

test('mandatory knowledge context always includes instructions and company in order', async () => {
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

  await service.processIncomingMessage('18095551234', 'quiero informacion');

  const companyContext = String(
    (capturedParams as { companyContext?: string } | null)?.companyContext ?? '',
  );

  assert.match(companyContext, /^\[INSTRUCCIONES\]/m);
  assert.match(companyContext, /^\[EMPRESA\]/m);
  assert.ok(
    companyContext.indexOf('[INSTRUCCIONES]') < companyContext.indexOf('[EMPRESA]'),
  );
});

test('location question answers immediately from company rules without AI', async () => {
  let aiCalls = 0;
  const service = createService({
    companyContextData: {
      companyName: 'Phyto Emagry',
      address: 'Santo Domingo',
      googleMapsLink: 'https://www.google.com/maps?q=18.48,-69.93',
    },
    onGenerateReply: () => {
      aiCalls += 1;
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'donde estan ubicados?');

  assert.equal(aiCalls, 0);
  assert.match(result.reply, /Santo Domingo/);
  assert.match(result.reply, /google\.com\/maps/);
});

test('payment question answers with real bank account data without AI', async () => {
  let aiCalls = 0;
  const service = createService({
    companyContextData: {
      companyName: 'Phyto Emagry',
      bankAccountsJson: [{
        bank: 'Banreservas',
        accountType: 'Ahorro',
        number: '123',
        holder: 'Empresa Demo',
        image: '',
      }],
    },
    onGenerateReply: () => {
      aiCalls += 1;
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'como pago?');

  assert.equal(aiCalls, 0);
  assert.match(result.reply, /Banreservas|Banco/i);
  assert.match(result.reply, /123/);
});

test('schedule question answers immediately from company rules without AI', async () => {
  let aiCalls = 0;
  const service = createService({
    companyContextData: {
      companyName: 'Phyto Emagry',
      workingHoursJson: [
        { day: 'lunes', open: true, from: '08:00', to: '18:00' },
        { day: 'martes', open: true, from: '08:00', to: '18:00' },
      ],
    },
    onGenerateReply: () => {
      aiCalls += 1;
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'cual es su horario?');

  assert.equal(aiCalls, 0);
  assert.match(result.reply, /08:00|18:00/i);
});

test('short confirmation message does not run AI', async () => {
  let aiCalled = false;
  const service = createService({
    onGenerateReply: () => {
      aiCalled = true;
    },
  });

  const result = await service.processIncomingMessage('18095551234', 'ok');

  assert.equal(aiCalled, false);
  assert.equal(result.source, 'hardcode');
  assert.match(result.reply.toLowerCase(), /precio|beneficios|usa|horario|ubicacion/);
});

test('closure phrases stop the sale before AI and persist conversation_end in Redis', async () => {
  let aiCalled = false;
  const service = createService({
    onGenerateReply: () => {
      aiCalled = true;
    },
  });

  const result = await service.processIncomingMessage('18095550001', 'ok gracias, te aviso');

  assert.equal(result.source, 'cierre');
  assert.equal(result.intent, 'cierre');
  assert.equal(aiCalled, false);
  assert.doesNotMatch(result.reply, /\?/);
  assert.equal((service as any).redisService.store.get('conversation_end:18095550001'), true);
});

test('todo bien is treated as a status acknowledgement (not conversation end)', async () => {
  let aiCalled = false;
  const service = createService({
    onGenerateReply: () => {
      aiCalled = true;
    },
  });

  const result = await service.processIncomingMessage('18095550002', 'Todo bien');

  assert.equal(result.source, 'micro');
  assert.equal(aiCalled, false);
  assert.match(result.reply.toLowerCase(), /que bueno|en que te puedo ayudar/);
  assert.equal((service as any).redisService.store.get('conversation_end:18095550002'), undefined);
});

test('dominican status phrases are handled as micro status (no AI, no conversation_end)', async () => {
  const samples = [
    'To bien y tu?',
    'Bien gracias',
    'Nítido y usted',
    'Heavy',
    'Todo heavy y ustedes',
  ];

  for (const [index, sample] of samples.entries()) {
    let aiCalled = false;
    const contactId = `1809555100${index}`;
    const service = createService({
      onGenerateReply: () => {
        aiCalled = true;
      },
    });

    const result = await service.processIncomingMessage(contactId, sample);

    assert.equal(result.source, 'micro');
    assert.equal(aiCalled, false);
    assert.match(result.reply.toLowerCase(), /que bueno|en que te puedo ayudar|quieres precio/);
    assert.equal((service as any).redisService.store.get(`conversation_end:${contactId}`), undefined);
  }
});

test('micro intent yes uses previous sales context to advance naturally without AI', async () => {
  let aiCalled = false;
  const service = createService();

  await (service as any).redisService.set('lastIntent:18095550100', 'compra');
  await (service as any).redisService.set('lastQuestion:18095550100', 'Quieres que te lo deje listo hoy?');
  (service as any).aiService.generateReply = async () => {
    aiCalled = true;
    return { type: 'text', content: 'No deberia usar IA aqui.' };
  };

  const result = await service.processIncomingMessage('18095550100', 'si');

  assert.equal(result.source, 'micro');
  assert.equal(result.intent, 'compra');
  assert.equal(aiCalled, false);
  assert.match(result.reply.toLowerCase(), /preparo|listo|pedido/);
  assert.equal((service as any).redisService.store.get('lastIntent:18095550100'), 'compra');
  assert.equal((service as any).redisService.store.get('lastMessageType:18095550100'), 'text');
});

test('micro intent no turns into a soft objection follow-up without AI', async () => {
  let aiCalled = false;
  const service = createService();

  await (service as any).redisService.set('lastIntent:18095550101', 'interesado');
  (service as any).aiService.generateReply = async () => {
    aiCalled = true;
    return { type: 'text', content: 'No deberia usar IA aqui.' };
  };

  const result = await service.processIncomingMessage('18095550101', 'no');

  assert.equal(result.source, 'micro');
  assert.equal(result.intent, 'duda');
  assert.equal(aiCalled, false);
  assert.match(result.reply.toLowerCase(), /convencio|duda|freno/);
});

test('plain gracias re-engages naturally when the conversation is still active', async () => {
  let aiCalled = false;
  const service = createService();

  await (service as any).redisService.set('lastIntent:18095550102', 'interesado');
  await (service as any).redisService.set('lastQuestion:18095550102', 'Quieres que te explique como se usa?');
  (service as any).aiService.generateReply = async () => {
    aiCalled = true;
    return { type: 'text', content: 'No deberia usar IA aqui.' };
  };

  const result = await service.processIncomingMessage('18095550102', 'gracias');

  assert.equal(result.source, 'micro');
  assert.notEqual(result.intent, 'cierre');
  assert.equal(aiCalled, false);
  assert.equal((service as any).redisService.store.get('conversation_end:18095550102'), undefined);
});

test('new contact with a pure greeting gets a human greeting without running AI', async () => {
  let aiCalled = false;
  const service = createService({
    onGenerateReply: () => {
      aiCalled = true;
    },
  });

  const result = await service.processIncomingMessage('18095550005', 'hola');

  assert.equal(result.source, 'hardcode');
  assert.equal(result.replyType, 'text');
  assert.equal(result.usedGallery, false);
  assert.equal(aiCalled, false);
  assert.match(result.reply.toLowerCase(), /hola/);
  assert.match(result.reply.toLowerCase(), /bajar de peso|info/);
  const key = findGreetingKey((service as any).redisService.store, '18095550005');
  assert.equal(key, null);
});

test('greeting keywords always respond immediately without running AI', async () => {
  let aiCalls = 0;
  const service = createService({
    aiReply: 'No deberia usarse.',
    onGenerateReply: () => {
      aiCalls += 1;
    },
  });

  const dayKey = getGreetingDayKey();
  await (service as any).redisService.set(`greeted:18095550006:${dayKey}`, true);

  const result = await service.processIncomingMessage('18095550006', 'hola');

  assert.equal(result.source, 'hardcode');
  assert.equal(aiCalls, 0);
  assert.match(result.reply.toLowerCase(), /hola/);
});

test('a closed conversation stays closed for generic messages until interest returns', async () => {
  let aiCalls = 0;
  const service = createService({
    aiReply: 'Cuesta RD$1,500 y te explico como pedirlo.',
    onGenerateReply: () => {
      aiCalls += 1;
    },
  });

  await (service as any).redisService.set('conversation_end:18095550002', true);

  const held = await service.processIncomingMessage('18095550002', 'hola');

  assert.equal(held.source, 'cierre');
  assert.equal(aiCalls, 0);
  assert.doesNotMatch(held.reply, /\?/);

  const reopened = await service.processIncomingMessage('18095550002', 'precio');

  assert.equal(reopened.source, 'hardcode');
  assert.equal(aiCalls, 0);
  assert.equal((service as any).redisService.store.get('conversation_end:18095550002'), undefined);
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

test('repeated price messages use the same hardcoded reply (no AI, no reply cache)', async () => {
  const service = createService({ mediaCount: 1 });
  const first = await service.processIncomingMessage('18095551234', 'precio');
  const second = await service.processIncomingMessage('18095551234', 'precio');

  assert.equal(first.source, 'hardcode');
  assert.equal(second.source, 'hardcode');
  assert.equal(first.cached, false);
  assert.equal(second.cached, false);
  assert.equal(second.reply, first.reply);
});

test('catalog request limits outgoing images to avoid saturating the client', async () => {
  const service = createService({ mediaCount: 5 });
  const result = await service.processIncomingMessage('18095551234', 'quiero catálogo');

  assert.equal(result.intent, 'catalogo');
  assert.equal(result.usedGallery, true);
  assert.equal(result.mediaFiles.length, 2);
});

test('AUTO TEST CASE 1: "quiero saber beneficios" responds with clear explanation and no product-chooser question', async () => {
  const service = createService({
    aiReply: [
      'Claro, te explico los beneficios del Te Detox Premium:',
      '- Apoya la digestión y te ayuda a sentirte más ligero/a',
      '- Puede ayudar con la hinchazón y el bienestar general',
      'Si quieres, también te digo el precio y cómo se usa. ¿Qué prefieres ahora?',
    ].join('\n'),
  });

  const result = await service.processIncomingMessage('18095557001', 'quiero saber beneficios');

  assert.equal(result.source, 'ai');
  assert.doesNotMatch(result.reply.toLowerCase(), /de cual producto|de cuál producto/);
  assert.match(result.reply.toLowerCase(), /beneficio|digest|bienestar|liger/);
  assert.match(result.reply, /\n- /);
  assert.match(result.reply, /\?$/);
});

test('AUTO TEST CASE 2: "como se usa" uses detailed style and explains before guiding', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    aiReply: [
      'Dale, te explico cómo se usa:',
      '1) Empieza con una taza al día',
      '2) Tómalo constante por varios días para notar la diferencia',
      '3) Acompáñalo con agua y comida ligera',
      '¿Quieres que te diga el precio también?',
    ].join('\n'),
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  const result = await service.processIncomingMessage('18095557002', 'como se usa');

  assert.equal(result.source, 'ai');
  assert.equal((capturedParams as { responseStyle?: string } | null)?.responseStyle, 'detailed');
  assert.doesNotMatch(result.reply.toLowerCase(), /de cual producto|de cuál producto/);
  assert.match(result.reply.toLowerCase(), /como se usa|se usa|taza|toma/);
  assert.match(result.reply, /\n1\)/);
  assert.match(result.reply, /\?$/);
});

test('AUTO TEST CASE 3: "precio" responds directly (single active product assumed)', async () => {
  const service = createService();
  const result = await service.processIncomingMessage('18095557003', 'precio');

  assert.equal(result.source, 'hardcode');
  assert.doesNotMatch(result.reply.toLowerCase(), /de cual producto|de cuál producto/);
  assert.match(result.reply, /Te Detox Premium/i);
  assert.match(result.reply.toLowerCase(), /cuesta|rd\$|precio/);
});

test('AUTO TEST CASE 4: "hola" greets naturally and keeps the conversation open', async () => {
  const service = createService();
  const result = await service.processIncomingMessage('18095557004', 'hola');

  assert.match(result.reply.toLowerCase(), /hola|hey|saludos|buenas/);
  assert.match(result.reply, /\?/);
  assert.doesNotMatch(result.reply.toLowerCase(), /de cual producto|de cuál producto/);
});

test('voice request by text uses audio when the answer needs explanation', async () => {
  const service = createService({
    generateReply: async () => ({
      type: 'text',
      content: 'Claro, te explico paso por paso como funciona, como se usa bien y que suele notar la gente para que entiendas todo completo antes de decidir.',
    }),
  });
  const result = await service.processIncomingMessage(
    '18095551234',
    'explicame por voz como funciona',
  );

  assert.equal(result.replyType, 'audio');
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

test('long explanation by text now prefers audio when the answer is detailed', async () => {
  const service = createService({
    generateReply: async () => ({
      type: 'audio',
      content: 'Claro, te explico paso por paso como funciona, que beneficios suele notar la gente, como se usa mejor y por que conviene seguirlo bien para que realmente veas resultado.',
    }),
  });

  const result = await service.processIncomingMessage(
    '18095551234',
    'quiero que me expliques bien que es exactamente este producto y como se usa porque tengo varias dudas',
  );

  assert.equal(result.replyType, 'audio');
});

test('long instructional text prefers audio', async () => {
  const service = createService({
    generateReply: async () => ({
      type: 'text',
      content: 'Mira, te explico paso por paso como tomarlo, a que hora te conviene mas, cuantos dias seguirlo y que detalle cuidar para aprovecharlo mejor sin complicarte.',
    }),
  });

  const result = await service.processIncomingMessage(
    '18095551234',
    'quiero las instrucciones paso por paso de como tomarlo y como se usa correctamente porque no quiero hacerlo mal',
  );

  assert.equal(result.replyType, 'audio');
});

test('emotional sales reply prefers audio when persuasion needs a long reply', async () => {
  const service = createService({
    generateReply: async () => ({
      type: 'text',
      content: 'Mira, te explico rapidito por que tanta gente se anima con este apoyo, que suele notar cuando lo usa bien y por que puede ayudarte a arrancar con mas confianza sin sentirte sola en el proceso.',
    }),
  });

  const result = await service.processIncomingMessage(
    '18095551234',
    'funciona de verdad o es cuento? quiero que me hables claro porque me da miedo botar mi dinero',
  );

  assert.equal(result.replyType, 'audio');
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

  const first = await service.processIncomingMessage('18095550001', 'de que trata la pastilla?');
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
  assert.notEqual(second.source, 'ai');
  assert.notEqual(second.intent, 'cierre');
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

test('thinking layer injects structured analysis before AI response generation', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    memoryContext: {
      messages: [
        { role: 'user', content: 'como funciona?' },
        { role: 'assistant', content: 'Claro, te explico como funciona.' },
      ],
      clientMemory: {
        interest: 'precio',
        status: 'interesado',
        lastIntent: 'consulta_precio',
      },
      summary: {
        summary: 'Ya se explicó el producto y ahora conviene avanzar.',
      },
    },
    aiReply: 'Te resumo lo importante y si quieres te digo el precio de una vez.',
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  await service.processIncomingMessage('18095559989', 'y el precio entonces?');

  const context = String((capturedParams as { context?: string } | null)?.context ?? '');
  const thinkingInstruction = String((capturedParams as { thinkingInstruction?: string } | null)?.thinkingInstruction ?? '');

  assert.match(context, /\[THINKING_RESULT\]/);
  assert.match(context, /alreadyExplained: true/);
  assert.match(context, /nextBestAction: (resumir|avanzar)/);
  assert.match(context, /responseStrategy:/);
  assert.match(thinkingInstruction, /Analiza primero, luego responde sin repetir/i);
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

  const result = await service.processIncomingMessage('18095559996', 'quiero informacion');

  assert.equal(result.source, 'fallback');
  assert.doesNotMatch(result.reply, /Configuracion incompleta del bot/i);
  assert.match(result.reply, /Te Detox Premium/i);
  assert.doesNotMatch(result.reply, /momentico|cargando|espera|verificar|revisar/i);
  assert.match(result.reply, /\?\s*$/);
});

test('sales fallback for hello stays sales-active and avoids wait language', async () => {
  const service = createService({
    memoryContext: {
      messages: [
        { role: 'user', content: 'precio' },
        { role: 'assistant', content: 'Cuesta RD$1,500.' },
      ],
      clientMemory: {
        status: 'interesado',
      },
    },
    generateReply: async () => {
      throw new Error('OpenAI unavailable');
    },
  });

  const result = await service.processIncomingMessage('18095559995', 'Hola');

  assert.equal(result.source, 'fallback');
  assert.match(result.reply, /hola/i);
  assert.match(result.reply, /Te Detox Premium/i);
  assert.doesNotMatch(result.reply, /momentico|cargando|espera|verificar|revisar/i);
  assert.match(result.reply, /\?\s*$/);
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

test('response cache reuses a safe text reply for another contact with the same message state', async () => {
  let aiCalls = 0;
  const service = createService({
    aiReply: 'Hola, dime con que te ayudo y te respondo rapido.',
    generateResponses: async () => {
      aiCalls += 1;
      return [
        {
          text: 'Hola, dime con que te ayudo y te respondo rapido.',
          type: 'text',
        },
      ];
    },
  });

  const first = await service.processIncomingMessage('18095554444', 'quiero informacion');
  const second = await service.processIncomingMessage('18095554445', 'quiero informacion');

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.source, 'cache');
  assert.equal(aiCalls, 1);
  assert.equal(second.reply, first.reply);
});

test('intent cache reuses classified intent for a similar message from the same contact', async () => {
  let classifyCalls = 0;
  const service = createService({
    classifyIntent: async () => {
      classifyCalls += 1;
      return 'interesado';
    },
    aiReply: 'Claro, dime que te interesa y te ayudo.',
  });

  await service.processIncomingMessage('18095554446', 'mmm');
  await service.processIncomingMessage('18095554446', 'mmm?');

  assert.equal(classifyCalls, 1);
});

test('media cache reuses gallery lookup for the same visual request', async () => {
  let mediaLookups = 0;
  const service = createService({
    mediaCount: 1,
    onMediaLookup: () => {
      mediaLookups += 1;
    },
    generateResponses: async () => ([
      {
        text: 'Te dejo una referencia para que lo veas mejor.',
        type: 'text',
      },
    ]),
  });

  await service.processIncomingMessage('18095554447', 'muestrame fotos');
  await service.processIncomingMessage('18095554448', 'muestrame fotos');

  assert.equal(mediaLookups, 1);
});
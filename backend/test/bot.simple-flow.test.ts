import assert from 'node:assert/strict';
import test from 'node:test';

import { BotService } from '../src/bot/bot.service';
import { DEFAULT_COMPANY_CONTEXT } from '../src/company-context/company-context.types';

const DEFAULT_AI_REPLY = [
  'Phytoemagry Caps te puede ayudar con control de apetito y apoyo al proceso de rebajar.',
  'Se usa siguiendo la dosis indicada en el producto.',
  'Si lo que tú quieres es bajar de peso con más apoyo, te puede servir.',
].join(' ');

function createService(options?: {
  aiReply?: string;
  generateReply?: (params: Record<string, unknown>) => Promise<{ type: 'text' | 'audio'; content: string }>;
  onGenerateReply?: (params: Record<string, unknown>) => void;
  configConfigurations?: Record<string, unknown>;
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
}) {
  const savedMessagesByContact = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();
  const redisStore = new Map<string, unknown>();
  const contactStateStore = new Map<string, Record<string, unknown>>();
  const summaryStore = new Map<string, Record<string, unknown>>();

  return new BotService(
    {
      async classifyIntent() {
        return 'curioso';
      },
      async generateReply(params: Record<string, unknown>) {
        options?.onGenerateReply?.(params);
        if (options?.generateReply) {
          return options.generateReply(params);
        }

        return {
          type: 'text' as const,
          content: options?.aiReply ?? DEFAULT_AI_REPLY,
        };
      },
      async generateResponses() {
        return [{ text: options?.aiReply ?? DEFAULT_AI_REPLY, type: 'text' as const }];
      },
    } as any,
    {
      async getConfig() {
        return {
          promptBase: 'Habla claro y humano.',
          promptShort: 'Responde directo.',
          promptHuman: 'Tono dominicano natural.',
          promptSales: 'Vende sin sonar robot.',
        };
      },
      getFullPrompt() {
        return 'Habla como humano, responde directo y usa productos reales.';
      },
    } as any,
    {
      async getContext() {
        return {
          id: 1,
          ...DEFAULT_COMPANY_CONTEXT,
          companyName: 'Phyto Emagry',
          phone: '809-555-1234',
          address: 'Santo Domingo',
          createdAt: new Date('2026-04-26T00:00:00.000Z'),
          updatedAt: new Date('2026-04-26T00:00:00.000Z'),
        };
      },
      async buildAgentContext() {
        return 'EMPRESA:\nNombre: Phyto Emagry\nTelefono: 809-555-1234\nDireccion: Santo Domingo';
      },
      async buildAgentContextForMessage() {
        return 'EMPRESA:\nNombre: Phyto Emagry\nTelefono: 809-555-1234\nDireccion: Santo Domingo';
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
                objective: 'Ayudar y vender',
                tone: 'Cercana',
              },
              rules: ['Responde con datos reales.'],
              products: [
                {
                  id: 'phyto-main',
                  titulo: 'Phytoemagry Caps',
                  descripcion_corta: 'Ayuda con control de apetito y apoyo al proceso de rebajar.',
                  descripcion_completa: 'Se usa siguiendo la dosis indicada en el producto.',
                  precio: 'RD$1,500',
                  activo: true,
                },
              ],
            },
          },
        };
      },
    } as any,
    {
      async getMediaByKeyword() {
        return [];
      },
    } as any,
    {
      async saveMessage(entry: { contactId?: string; role: string; content: string }) {
        const contactId = String(entry.contactId ?? 'test-contact');
        const current = savedMessagesByContact.get(contactId) ?? [];
        current.push({ role: entry.role as 'user' | 'assistant', content: entry.content });
        savedMessagesByContact.set(contactId, current);
        return entry;
      },
      async getConversationContext(contactId?: string) {
        const override = options?.memoryContext;
        const storedMessages = savedMessagesByContact.get(String(contactId ?? 'test-contact')) ?? [];

        return {
          messages: override?.messages ?? storedMessages.map((item) => ({ role: item.role, content: item.content })),
          clientMemory: {
            contactId: 'test-contact',
            name: null,
            objective: null,
            interest: null,
            objections: [],
            status: 'nuevo' as const,
            lastIntent: null,
            notes: null,
            updatedAt: null,
            expiresAt: null,
            ...(override?.clientMemory ?? {}),
          },
          summary: {
            contactId: 'test-contact',
            summary: null,
            updatedAt: null,
            expiresAt: null,
            ...(override?.summary ?? {}),
          },
        };
      },
      async getRecentMessages(contactId?: string) {
        const override = options?.memoryContext;
        if (override?.messages) {
          return override.messages;
        }

        const storedMessages = savedMessagesByContact.get(String(contactId ?? 'test-contact')) ?? [];
        return storedMessages.map((item) => ({ role: item.role, content: item.content }));
      },
    } as any,
    {
      async get(key: string) {
        return redisStore.get(key) ?? null;
      },
      async set(key: string, value: unknown) {
        redisStore.set(key, value);
      },
      async setIfAbsent(key: string, value: unknown) {
        if (redisStore.has(key)) {
          return false;
        }
        redisStore.set(key, value);
        return true;
      },
      async del(key: string) {
        redisStore.delete(key);
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
}

test('uses a single direct AI reply for a normal message', async () => {
  let aiCalls = 0;
  const service = createService({
    generateReply: async () => {
      aiCalls += 1;
      return { type: 'text', content: DEFAULT_AI_REPLY };
    },
  });

  const result = await service.processIncomingMessage('18095550001', 'hola');

  assert.equal(aiCalls, 1);
  assert.equal(result.source, 'ai');
  assert.equal(result.reply, DEFAULT_AI_REPLY);
});

test('injects the lightweight thinker before the AI call', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  await service.processIncomingMessage('18095550002', 'quiero información');

  const context = String((capturedParams as { context?: string } | null)?.context ?? '');
  assert.match(context, /\[PENSADOR\]/);
  assert.match(context, /intent: info/);
  assert.doesNotMatch(context, /\[THINKING_RESULT\]/);
});

test('generic product references assume the Phytoemagry product automatically', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'other-1',
            titulo: 'Otro Producto',
            descripcion_corta: 'Otro producto de prueba.',
            precio: 'RD$900',
            activo: true,
          },
          {
            id: 'phyto-1',
            titulo: 'Phytoemagry Caps',
            descripcion_corta: 'Ayuda con control de apetito.',
            precio: 'RD$1,500',
            activo: true,
          },
        ],
      },
    },
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  await service.processIncomingMessage('18095550003', 'esa pastilla funciona?');

  const companyContext = String((capturedParams as { companyContext?: string } | null)?.companyContext ?? '');
  assert.match(companyContext, /Phytoemagry Caps/);
});

test('generic product references use the active product from memory before guessing', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
        },
        products: [
          {
            id: 'other-1',
            titulo: 'Otro Producto',
            descripcion_corta: 'Otro producto de prueba.',
            precio: 'RD$900',
            activo: true,
          },
          {
            id: 'phyto-1',
            titulo: 'Phytoemagry Caps',
            descripcion_corta: 'Ayuda con control de apetito.',
            precio: 'RD$1,500',
            activo: true,
          },
        ],
      },
    },
    memoryContext: {
      messages: [
        { role: 'user', content: 'háblame de Otro Producto' },
        { role: 'assistant', content: 'Otro Producto cuesta RD$900 y te explico cómo se usa si quieres.' },
      ],
    },
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  await service.processIncomingMessage('18095550008', 'esa pastilla me interesa');

  const companyContext = String((capturedParams as { companyContext?: string } | null)?.companyContext ?? '');
  assert.match(companyContext, /Otro Producto/);
  assert.doesNotMatch(companyContext, /Phytoemagry Caps/);
});

test('filters price requests down to instructions plus relevant product price only', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
          role: 'Asesora comercial',
          tone: 'Cercana',
        },
        products: [
          {
            id: 'other-1',
            titulo: 'Otro Producto',
            descripcion_corta: 'Otro producto de prueba.',
            precio: 'RD$900',
            activo: true,
          },
          {
            id: 'phyto-1',
            titulo: 'Phytoemagry Caps',
            descripcion_corta: 'Ayuda con control de apetito.',
            descripcion_completa: 'Tomar siguiendo la dosis indicada.',
            precio: 'RD$1,500',
            activo: true,
          },
        ],
      },
    },
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  await service.processIncomingMessage('18095550009', 'precio de phytoemagry');

  const companyContext = String((capturedParams as { companyContext?: string } | null)?.companyContext ?? '');
  assert.match(companyContext, /\[INSTRUCCIONES\]/);
  assert.match(companyContext, /\[PRODUCTO_RELEVANTE\]/);
  assert.match(companyContext, /Phytoemagry Caps/);
  assert.match(companyContext, /Precio: RD\$1,500/);
  assert.doesNotMatch(companyContext, /Otro Producto/);
  assert.doesNotMatch(companyContext, /\[EMPRESA\]/);
});

test('does not rewrite or validate-block the AI reply after generation', async () => {
  const rawReply = 'Claro, dime qué necesitas.';
  const service = createService({
    aiReply: rawReply,
  });

  const result = await service.processIncomingMessage('18095550004', 'hola');

  assert.equal(result.source, 'ai');
  assert.equal(result.reply, rawReply);
});

test('regenerates once with variation when the new reply is too similar to the previous one', async () => {
  const regenerationInstructions: string[] = [];
  let calls = 0;
  const service = createService({
    memoryContext: {
      messages: [
        { role: 'user', content: 'precio?' },
        { role: 'assistant', content: 'Phytoemagry Caps cuesta RD$1,500.' },
      ],
    },
    generateReply: async (params) => {
      calls += 1;
      regenerationInstructions.push(String(params.regenerationInstruction ?? ''));

      if (calls === 1) {
        return { type: 'text', content: 'Phytoemagry Caps cuesta RD$1,500.' };
      }

      return {
        type: 'text',
        content: 'Phytoemagry Caps está en RD$1,500 y si quieres te explico de una vez cómo se usa.',
      };
    },
  });

  const result = await service.processIncomingMessage('18095550005', 'precio?');

  assert.equal(calls, 2);
  assert.notEqual(result.reply, 'Phytoemagry Caps cuesta RD$1,500.');
  assert.match(regenerationInstructions[1] ?? '', /demasiado parecida/i);
});

test('keeps filtered knowledge under the 2000 character cap', async () => {
  let capturedParams: Record<string, unknown> | null = null;
  const service = createService({
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
          role: 'Asesora comercial con mucho detalle y varias reglas internas para responder humano',
          tone: 'Cercana y muy explicativa',
        },
        rules: Array.from({ length: 20 }, (_, index) => `Regla extensa ${index + 1} con detalles para no inventar datos ni salir del contexto.`),
        products: [
          {
            id: 'phyto-1',
            titulo: 'Phytoemagry Caps',
            descripcion_corta: 'Ayuda con control de apetito y apoyo al proceso de rebajar con una descripción bastante larga para forzar recorte.',
            descripcion_completa: 'Tomar siguiendo la dosis indicada y mantener constancia. Esta descripción también es larga para comprobar que el filtro compacta antes de enviar a la IA.',
            precio: 'RD$1,500',
            activo: true,
          },
        ],
      },
    },
    onGenerateReply: (params) => {
      capturedParams = params;
    },
  });

  await service.processIncomingMessage('18095550010', 'como se usa phytoemagry?');

  const companyContext = String((capturedParams as { companyContext?: string } | null)?.companyContext ?? '');
  assert.ok(companyContext.length <= 2000);
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

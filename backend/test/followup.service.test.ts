import assert from 'node:assert/strict';
import test from 'node:test';

import { FollowupService } from '../src/followup/followup.service';

function createFollowupHarness(options?: {
  aiReply?: string;
  aiResponses?: Array<{ text: string; type?: 'text' | 'audio' }>;
  clientMemory?: Record<string, unknown>;
  initialMessages?: Array<{ contactId: string; role: string; content: string }>;
  summary?: string;
  closedContacts?: string[];
}) {
  const followups = new Map<string, any>();
  const sentMessages: Array<{ to: string; text: string }> = [];
  const savedMessages: Array<{ contactId: string; role: string; content: string }> = [];
  const aiCalls: any[] = [];
  const initialMessages = [...(options?.initialMessages ?? [])];
  const redisStore = new Map<string, unknown>();
  for (const contactId of options?.closedContacts ?? []) {
    redisStore.set(`conversation_end:${contactId}`, true);
  }
  const config = {
    botSettings: {
      followupEnabled: true,
      followup1DelayMinutes: 10,
      followup2DelayMinutes: 30,
      followup3DelayHours: 24,
      maxFollowups: 3,
      stopIfUserReply: true,
    },
    whatsappSettings: {
      apiBaseUrl: 'https://evolution.example.com',
      apiKey: 'demo-key',
      instanceName: 'demo-instance',
    },
    openaiKey: '',
  };

  const service = new FollowupService(
    {
      conversationFollowup: {
        async upsert({ where: { contactId }, create, update }: any) {
          const current = followups.get(contactId);
          const next = {
            id: current?.id ?? followups.size + 1,
            contactId,
            createdAt: current?.createdAt ?? new Date(),
            updatedAt: new Date(),
            ...(current ?? {}),
            ...(current ? update : create),
          };
          followups.set(contactId, next);
          return next;
        },
        async updateMany({ where: { contactId }, data }: any) {
          const current = followups.get(contactId);
          if (!current) {
            return { count: 0 };
          }
          followups.set(contactId, { ...current, ...data, updatedAt: new Date() });
          return { count: 1 };
        },
        async findMany({ where }: any) {
          return Array.from(followups.values()).filter((item) =>
            item.isActive === where.isActive &&
            item.lastMessageFrom === where.lastMessageFrom &&
            item.nextFollowupAt &&
            item.nextFollowupAt <= where.nextFollowupAt.lte,
          );
        },
        async update({ where: { contactId }, data }: any) {
          const current = followups.get(contactId);
          const next = { ...current, ...data, updatedAt: new Date() };
          followups.set(contactId, next);
          return next;
        },
      },
    } as any,
    {
      async generateReply(params: any) {
        aiCalls.push(params);
        return {
          type: 'text',
          content:
              options?.aiReply ??
              'Hola 👋 solo paso por aquí por si todavía te interesa.',
        };
      },
      async generateResponses(params: any) {
        aiCalls.push(params);

        if (options?.aiResponses) {
          return options.aiResponses;
        }

        return [{
          text:
            options?.aiReply ??
            'Hola 👋 solo paso por aquí por si todavía te interesa.',
          type: 'text',
        }];
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
        return '';
      },
    } as any,
    {
      async getConfig() {
        return config;
      },
    } as any,
    {
      async getConversationContext(contactId: string) {
        return {
          messages: [...initialMessages, ...savedMessages]
            .filter((item) => item.contactId === contactId)
            .map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content })),
          clientMemory: {
            contactId,
            name: 'Ana',
            objective: 'info',
            interest: 'precio',
            objections: [],
            status: 'interesado',
            lastIntent: 'consulta_precio',
            notes: null,
            updatedAt: null,
            expiresAt: null,
            ...(options?.clientMemory ?? {}),
          },
          summary: {
            contactId,
            summary:
                options?.summary ??
                'Cliente interesada en precio y esperando decidir.',
            updatedAt: null,
            expiresAt: null,
          },
        };
      },
      async saveMessage(entry: any) {
        savedMessages.push(entry);
        return entry;
      },
    } as any,
    {
      async get(key: string) {
        return redisStore.get(key) ?? null;
      },
    } as any,
  );

  Object.defineProperty(service as any, 'sendFollowupText', {
    value: async (to: string, text: string) => {
      sentMessages.push({ to, text });
    },
  });

  return { service, followups, sentMessages, savedMessages, aiCalls };
}

function assertDelayWithin(date: Date | null, expectedMs: number, toleranceMs = 5000) {
  assert.ok(date instanceof Date);
  const delta = date.getTime() - Date.now();
  assert.ok(Math.abs(delta - expectedMs) <= toleranceMs);
}

test('registerBotReply activates step 0 and schedules next followup', async () => {
  const { service, followups } = createFollowupHarness();

  await service.registerBotReply({
    contactId: '18095551111',
    outboundAddress: '18095551111@s.whatsapp.net',
    reply: 'Te lo dejo por aquí.',
  });

  const record = followups.get('18095551111');
  assert.equal(record.lastMessageFrom, 'bot');
  assert.equal(record.followupStep, 0);
  assert.equal(record.isActive, true);
  assertDelayWithin(record.nextFollowupAt, 10 * 60 * 1000);
});

test('registerUserReply deactivates active followup', async () => {
  const { service, followups } = createFollowupHarness();

  await service.registerBotReply({
    contactId: '18095552222',
    outboundAddress: '18095552222@s.whatsapp.net',
    reply: 'Quedo atento.',
  });
  await service.registerUserReply('18095552222');

  const record = followups.get('18095552222');
  assert.equal(record.lastMessageFrom, 'user');
  assert.equal(record.isActive, false);
  assert.equal(record.nextFollowupAt, null);
});

test('processDueFollowups sends natural followup and advances step', async () => {
  const { service, followups, sentMessages, savedMessages } = createFollowupHarness();

  await service.registerBotReply({
    contactId: '18095553333',
    outboundAddress: '18095553333@s.whatsapp.net',
    reply: 'Mira, te puede ayudar bastante.',
  });

  const current = followups.get('18095553333');
  current.nextFollowupAt = new Date(Date.now() - 60 * 1000);
  followups.set('18095553333', current);

  await service.processDueFollowups();

  const updated = followups.get('18095553333');
  assert.equal(sentMessages.length, 1);
  assert.equal(savedMessages.at(-1)?.content, sentMessages[0]?.text);
  assert.equal(updated.followupStep, 1);
  assert.equal(updated.isActive, true);
  assertDelayWithin(updated.nextFollowupAt, 30 * 60 * 1000);
});

test('stops after the third followup to avoid spam', async () => {
  const { service, followups, sentMessages } = createFollowupHarness();

  await service.registerBotReply({
    contactId: '18095554444',
    outboundAddress: '18095554444@s.whatsapp.net',
    reply: 'Perfecto.',
  });

  for (let index = 0; index < 3; index += 1) {
    const current = followups.get('18095554444');
    current.nextFollowupAt = new Date(Date.now() - 60 * 1000);
    followups.set('18095554444', current);
    await service.processDueFollowups();
  }

  const updated = followups.get('18095554444');
  assert.equal(sentMessages.length, 3);
  assert.equal(updated.followupStep, 3);
  assert.equal(updated.isActive, false);
  assert.equal(updated.nextFollowupAt, null);
});

test('does not schedule followup when customer is already a client', async () => {
  const { service, followups, sentMessages } = createFollowupHarness();

  await service.registerBotReply({
    contactId: '18095555555',
    outboundAddress: '18095555555@s.whatsapp.net',
    reply: 'Perfecto.',
  });

  const suppressedHarness = createFollowupHarness({
    clientMemory: { status: 'cliente' },
  });

  await suppressedHarness.service.registerBotReply({
    contactId: '18095556666',
    outboundAddress: '18095556666@s.whatsapp.net',
    reply: 'Perfecto.',
  });

  assert.equal(suppressedHarness.followups.get('18095556666'), undefined);
  assert.equal(sentMessages.length, 0);
});

test('does not schedule followup after a clear closing message from the customer', async () => {
  const { service, followups } = createFollowupHarness({
    initialMessages: [
      {
        contactId: '18095557777',
        role: 'user',
        content: 'No gracias, yo te aviso mas tarde.',
      },
    ],
  });

  await service.registerBotReply({
    contactId: '18095557777',
    outboundAddress: '18095557777@s.whatsapp.net',
    reply: 'Perfecto.',
  });

  assert.equal(followups.get('18095557777'), undefined);
});

test('does not schedule followup when the conversation is marked as ended in Redis', async () => {
  const { service, followups } = createFollowupHarness({
    closedContacts: ['18095550003'],
  });

  await service.registerBotReply({
    contactId: '18095550003',
    outboundAddress: '18095550003@s.whatsapp.net',
    reply: 'Perfecto.',
  });

  assert.equal(followups.get('18095550003'), undefined);
});

test('processDueFollowups deactivates queued followups when the conversation is ended in Redis', async () => {
  const { service, followups, sentMessages } = createFollowupHarness();

  await service.registerBotReply({
    contactId: '18095550004',
    outboundAddress: '18095550004@s.whatsapp.net',
    reply: 'Perfecto.',
  });

  await (service as any).redisService.get('conversation_end:18095550004');
  (service as any).redisService.get = async (key: string) => (
    key === 'conversation_end:18095550004' ? true : null
  );

  const current = followups.get('18095550004');
  current.nextFollowupAt = new Date(Date.now() - 60 * 1000);
  followups.set('18095550004', current);

  await service.processDueFollowups();

  const updated = followups.get('18095550004');
  assert.equal(sentMessages.length, 0);
  assert.equal(updated.isActive, false);
  assert.equal(updated.nextFollowupAt, null);
});

test('uses name and memory context for AI followups and avoids literal repetition', async () => {
  const repeatedMessage = 'Te escribo para ver si todavía te interesa 👍';
  const { service, followups, sentMessages, aiCalls } = createFollowupHarness({
    aiReply: repeatedMessage,
  });

  await service.registerBotReply({
    contactId: '18095558888',
    outboundAddress: '18095558888@s.whatsapp.net',
    reply: repeatedMessage,
  });

  const current = followups.get('18095558888');
  current.nextFollowupAt = new Date(Date.now() - 60 * 1000);
  followups.set('18095558888', current);

  await service.processDueFollowups();

  assert.equal(aiCalls.length, 3);
  assert.match(aiCalls[0].message, /Usa el nombre Ana/i);
  assert.match(aiCalls[0].message, /humano dominicano/i);
  assert.match(aiCalls[0].context, /Resumen de la conversacion/i);
  assert.match(aiCalls[0].context, /Objetivo del cliente: info/i);
  assert.match(aiCalls[1].regenerationInstruction, /No repitas el ultimo follow-up/i);
  assert.notEqual(sentMessages[0]?.text, repeatedMessage);
  assert.equal(sentMessages.length, 1);
});

test('followup orchestrator picks a second candidate when the first one repeats the previous followup', async () => {
  const repeatedMessage = 'Te escribo para ver si todavía te interesa 👍';
  const { service, followups, sentMessages } = createFollowupHarness({
    aiResponses: [
      { text: repeatedMessage, type: 'text' },
      { text: 'Ana, sigo por aquí por si quieres que te lo explique más claro.', type: 'text' },
    ],
  });

  await service.registerBotReply({
    contactId: '18095559911',
    outboundAddress: '18095559911@s.whatsapp.net',
    reply: repeatedMessage,
  });

  const current = followups.get('18095559911');
  current.nextFollowupAt = new Date(Date.now() - 60 * 1000);
  followups.set('18095559911', current);

  await service.processDueFollowups();

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.text, 'Ana, sigo por aquí por si quieres que te lo explique más claro.');
});
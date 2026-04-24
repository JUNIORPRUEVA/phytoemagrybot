import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryService } from '../src/memory/memory.service';
import { StoredMessage } from '../src/memory/memory.types';

function createMemoryHarness() {
  const redisBuffers = new Map<string, StoredMessage[]>();
  const redisCounters = new Map<string, number>();
  const profiles = new Map<string, any>();
  const summaries = new Map<string, any>();
  const conversationMessages: Array<{ contactId: string; createdAt: Date }> = [];

  const prisma = {
    clientMemory: {
      async findUnique({ where: { contactId } }: { where: { contactId: string } }) {
        return profiles.get(contactId) ?? null;
      },
      async upsert({ where: { contactId }, create, update }: { where: { contactId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) {
        const current = profiles.get(contactId) ?? null;
        const next = {
          id: current?.id ?? profiles.size + 1,
          contactId,
          updatedAt: new Date(),
          ...current,
          ...(current ? update : create),
        };
        profiles.set(contactId, next);
        return next;
      },
      async updateMany({ where: { contactId }, data }: { where: { contactId: string }; data: Record<string, unknown> }) {
        const current = profiles.get(contactId);
        if (!current) {
          return { count: 0 };
        }
        profiles.set(contactId, { ...current, ...data, updatedAt: new Date() });
        return { count: 1 };
      },
      async deleteMany({ where }: { where: { contactId?: string; expiresAt?: { lte: Date } } }) {
        if (where.contactId) {
          const existed = profiles.delete(where.contactId);
          return { count: existed ? 1 : 0 };
        }

        let count = 0;
        for (const [contactId, value] of Array.from(profiles.entries())) {
          if (where.expiresAt && value.expiresAt <= where.expiresAt.lte) {
            profiles.delete(contactId);
            count += 1;
          }
        }
        return { count };
      },
      async findMany({ where }: { where?: { expiresAt?: { gt: Date } } }) {
        return Array.from(profiles.values()).filter((item) => !where?.expiresAt || item.expiresAt > where.expiresAt.gt);
      },
    },
    conversationSummary: {
      async findUnique({ where: { contactId } }: { where: { contactId: string } }) {
        return summaries.get(contactId) ?? null;
      },
      async upsert({ where: { contactId }, create, update }: { where: { contactId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) {
        const current = summaries.get(contactId) ?? null;
        const next = {
          id: current?.id ?? summaries.size + 1,
          contactId,
          updatedAt: new Date(),
          ...current,
          ...(current ? update : create),
        };
        summaries.set(contactId, next);
        return next;
      },
      async updateMany({ where: { contactId }, data }: { where: { contactId: string }; data: Record<string, unknown> }) {
        const current = summaries.get(contactId);
        if (!current) {
          return { count: 0 };
        }
        summaries.set(contactId, { ...current, ...data, updatedAt: new Date() });
        return { count: 1 };
      },
      async deleteMany({ where }: { where: { contactId?: string; expiresAt?: { lte: Date } } }) {
        if (where.contactId) {
          const existed = summaries.delete(where.contactId);
          return { count: existed ? 1 : 0 };
        }

        let count = 0;
        for (const [contactId, value] of Array.from(summaries.entries())) {
          if (where.expiresAt && value.expiresAt <= where.expiresAt.lte) {
            summaries.delete(contactId);
            count += 1;
          }
        }
        return { count };
      },
      async findMany({ where }: { where?: { expiresAt?: { gt: Date } } }) {
        return Array.from(summaries.values()).filter((item) => !where?.expiresAt || item.expiresAt > where.expiresAt.gt);
      },
    },
    conversationMessage: {
      async findMany({ where: { contactId }, take }: { where: { contactId: string }; take: number }) {
        return conversationMessages
          .filter((item) => item.contactId === contactId)
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
          .slice(0, take)
          .map((item) => ({ role: 'user', content: 'legacy', createdAt: item.createdAt }));
      },
      async deleteMany({ where: { createdAt } }: { where: { createdAt: { lt: Date } } }) {
        const before = conversationMessages.length;
        for (let index = conversationMessages.length - 1; index >= 0; index -= 1) {
          if (conversationMessages[index].createdAt < createdAt.lt) {
            conversationMessages.splice(index, 1);
          }
        }
        return { count: before - conversationMessages.length };
      },
      async groupBy() {
        return [];
      },
    },
  };

  const redis = {
    async appendConversationMessage(contactId: string, message: StoredMessage, limit = 20) {
      const next = [...(redisBuffers.get(contactId) ?? []), message].slice(-limit);
      redisBuffers.set(contactId, next);
      return next;
    },
    async getConversationMessages(contactId: string, limit = 10) {
      return [...(redisBuffers.get(contactId) ?? [])].slice(-limit);
    },
    async setConversationMessages(contactId: string, messages: StoredMessage[]) {
      redisBuffers.set(contactId, [...messages]);
    },
    async increment(key: string) {
      const next = (redisCounters.get(key) ?? 0) + 1;
      redisCounters.set(key, next);
      return next;
    },
  };

  const config = {
    async getConfig() {
      return {
        openaiKey: '',
        aiSettings: {
          modelName: 'gpt-4o-mini',
        },
      };
    },
  };

  return {
    service: new MemoryService(prisma as any, redis as any, config as any),
    stores: {
      redisBuffers,
      profiles,
      summaries,
      conversationMessages,
      redisCounters,
    },
  };
}

test('redis short memory keeps the latest 20 messages in order', async () => {
  const { service } = createMemoryHarness();

  for (let index = 1; index <= 22; index += 1) {
    await service.saveMessage({
      contactId: '18095550010',
      role: 'assistant',
      content: `msg-${index}`,
    });
  }

  const recent = await service.getRecentMessages('18095550010', 20);

  assert.equal(recent.length, 20);
  assert.equal(recent[0]?.content, 'msg-3');
  assert.equal(recent[19]?.content, 'msg-22');
});

test('postgres profile stores only useful customer signals and skips noise', async () => {
  const { service, stores } = createMemoryHarness();

  await service.saveMessage({
    contactId: '18095550011',
    role: 'user',
    content: 'hola',
  });

  assert.equal(stores.profiles.size, 0);

  await service.saveMessage({
    contactId: '18095550011',
    role: 'user',
    content: 'quiero rebajar rapido, pero cuanto cuesta?',
  });

  const profile = await service.getClientMemory('18095550011');

  assert.equal(profile.objective, 'rebajar');
  assert.equal(profile.interest, 'precio');
  assert.equal(profile.status, 'interesado');
  assert.deepEqual(profile.objections, []);
  assert.ok(profile.expiresAt instanceof Date);
});

test('postgres summary is generated after five user messages and stays under 2KB', async () => {
  const { service } = createMemoryHarness();
  const contactId = '18095550012';

  const messages = [
    'hola',
    'quiero rebajar rapido',
    'cuanto cuesta?',
    'funciona de verdad?',
    'como compro?',
  ];

  for (const message of messages) {
    await service.saveMessage({ contactId, role: 'user', content: message });
  }

  const summary = await service.getSummary(contactId);

  assert.ok(summary.summary);
  assert.ok(summary.summary!.length <= 2048);
  assert.ok(summary.expiresAt instanceof Date);
  assert.match(summary.summary!, /rebajar|precio|funciona|compro/i);
});

test('cleanup removes expired profile and summary after 15 days', async () => {
  const { service, stores } = createMemoryHarness();
  const expiredDate = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000);

  stores.profiles.set('18095550013', {
    id: 1,
    contactId: '18095550013',
    name: 'Pedro',
    objective: 'comprar',
    interest: 'precio',
    objections: [],
    status: 'interesado',
    lastIntent: 'HOT',
    notes: null,
    updatedAt: expiredDate,
    expiresAt: expiredDate,
  });
  stores.summaries.set('18095550013', {
    id: 1,
    contactId: '18095550013',
    summary: 'Resumen viejo',
    updatedAt: expiredDate,
    expiresAt: expiredDate,
  });
  stores.conversationMessages.push({
    contactId: '18095550013',
    createdAt: expiredDate,
  });

  await service.cleanupExpiredMemory();

  const profile = await service.getClientMemory('18095550013');
  const summary = await service.getSummary('18095550013');

  assert.equal(profile.name, null);
  assert.equal(summary.summary, null);
  assert.equal(stores.conversationMessages.length, 0);
});
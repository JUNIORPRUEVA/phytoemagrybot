import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryService } from '../src/memory/memory.service';

test('deleteClientMemory clears persistent and runtime state for one contact', async () => {
  const deletedPatterns: string[] = [];
  const deletedKeys: string[][] = [];
  const prisma = {
    conversationMemory: { deleteMany: async () => ({ count: 2 }) },
    conversationMessage: { deleteMany: async () => ({ count: 3 }) },
    conversationSummary: { deleteMany: async () => ({ count: 1 }) },
    clientMemory: { deleteMany: async () => ({ count: 1 }) },
    contactState: { deleteMany: async () => ({ count: 1 }) },
    contactConversationSummary: { deleteMany: async () => ({ count: 1 }) },
    conversationFollowup: { deleteMany: async () => ({ count: 1 }) },
    $transaction: async (operations: Array<Promise<{ count: number }>>) => Promise.all(operations),
  };
  const redis = {
    deleteMany: async (keys: string[]) => {
      deletedKeys.push(keys);
    },
    deleteByPattern: async (pattern: string) => {
      deletedPatterns.push(pattern);
      return 2;
    },
  };

  const service = new MemoryService(prisma as any, redis as any, {} as any);
  const result = await service.deleteClientMemory('18095551234', 'dashboard-ui');

  assert.equal(result.ok, true);
  assert.equal(result.action, 'delete-client');
  assert.equal(result.actor, 'dashboard-ui');
  assert.equal(result.contactId, '18095551234');
  assert.equal(result.counts.clientMemory, 1);
  assert.equal(result.counts.conversationMessages, 3);
  assert.equal(deletedKeys.length, 1);
  assert.deepEqual(deletedPatterns, ['cache:18095551234:*', 'wa-inbound:18095551234:*']);
});

test('resetAllMemory truncates memory tables and clears runtime memory patterns', async () => {
  let executedSql = '';
  const deletedPatterns: string[] = [];
  const prisma = {
    $transaction: async (
      callback: (tx: { $executeRawUnsafe: (sql: string) => Promise<void> }) => Promise<void>,
    ) => {
      await callback({
        $executeRawUnsafe: async (sql: string) => {
          executedSql = sql;
        },
      });
    },
  };
  const redis = {
    deleteByPattern: async (pattern: string) => {
      deletedPatterns.push(pattern);
      return 1;
    },
  };

  const service = new MemoryService(prisma as any, redis as any, {} as any);
  const result = await service.resetAllMemory('dashboard-ui');

  assert.equal(result.ok, true);
  assert.equal(result.action, 'reset-all');
  assert.match(executedSql, /TRUNCATE TABLE/);
  assert.ok(deletedPatterns.includes('voice-pref:*'));
  assert.ok(deletedPatterns.includes('memory:summary-count:*'));
});
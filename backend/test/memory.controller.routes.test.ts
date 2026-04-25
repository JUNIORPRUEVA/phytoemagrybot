import test from 'node:test';
import assert from 'node:assert/strict';

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';

import { MemoryController } from '../src/memory/memory.controller';
import { MemoryService } from '../src/memory/memory.service';

function buildJson(body: unknown) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  } as const;
}

test('MemoryController routes: static delete endpoints do not match :contactId', async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const memoryServiceMock = {
    updateMemoryEntry: async (...args: unknown[]) => {
      calls.push({ method: 'updateMemoryEntry', args });
      return { ok: true };
    },
    deleteClientMemory: async (...args: unknown[]) => {
      calls.push({ method: 'deleteClientMemory', args });
      return { ok: true, action: 'delete-client', actor: 'test', contactId: 'x', deletedAt: new Date().toISOString(), counts: { redisKeys: 0 } };
    },
    deleteConversation: async (...args: unknown[]) => {
      calls.push({ method: 'deleteConversation', args });
      return { ok: true, action: 'delete-conversation', actor: 'test', contactId: 'x', deletedAt: new Date().toISOString(), counts: { redisKeys: 0 } };
    },
    deleteAllConversations: async (...args: unknown[]) => {
      calls.push({ method: 'deleteAllConversations', args });
      return { ok: true, action: 'delete-all-conversations', actor: 'test', contactId: null, deletedAt: new Date().toISOString(), counts: { redisKeys: 0 } };
    },
    resetAllMemory: async (...args: unknown[]) => {
      calls.push({ method: 'resetAllMemory', args });
      return { ok: true, action: 'reset-all', actor: 'test', contactId: null, deletedAt: new Date().toISOString(), counts: { redisKeys: 0 } };
    },
    listContacts: async () => [],
    getSummary: async () => ({ contactId: 'x', summary: null, updatedAt: null, expiresAt: null }),
    getConversationContext: async () => ({ messages: [], clientMemory: {}, summary: {} }),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [MemoryController],
    providers: [{ provide: MemoryService, useValue: memoryServiceMock }],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);

  const baseUrl = await app.getUrl();

  const responses = await Promise.all([
    fetch(`${baseUrl}/memory/delete-client`, buildJson({ contactId: '18095551234', actor: 'dashboard-ui' })),
    fetch(`${baseUrl}/memory/delete-conversation`, buildJson({ contactId: '18095551234', actor: 'dashboard-ui' })),
    fetch(`${baseUrl}/memory/delete-all-conversations`, buildJson({ actor: 'dashboard-ui' })),
    fetch(`${baseUrl}/memory/reset-all`, buildJson({ actor: 'dashboard-ui' })),
    fetch(`${baseUrl}/memory/18095551234`, buildJson({ name: 'Test' })),
  ]);

  for (const res of responses) {
    assert.equal(res.status, 201);
  }

  const calledMethods = calls.map((entry) => entry.method);

  assert.ok(calledMethods.includes('deleteClientMemory'));
  assert.ok(calledMethods.includes('deleteConversation'));
  assert.ok(calledMethods.includes('deleteAllConversations'));
  assert.ok(calledMethods.includes('resetAllMemory'));
  assert.ok(calledMethods.includes('updateMemoryEntry'));

  // Critical: the static delete routes should not be handled by updateMemoryEntry.
  const updateCalls = calls.filter((entry) => entry.method === 'updateMemoryEntry');
  assert.equal(updateCalls.length, 1);

  await app.close();
});

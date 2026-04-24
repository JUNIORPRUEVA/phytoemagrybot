import assert from 'node:assert/strict';
import test from 'node:test';

import { BotService } from '../src/bot/bot.service';
import { BotReplyResult } from '../src/bot/bot.types';

function createService(options?: {
  mediaCount?: number;
  lastIntent?: string | null;
  aiReply?: string;
}) {
  const savedMessages: Array<{ role: string; content: string }> = [];
  const memoryState = {
    lastIntent: options?.lastIntent ?? null,
  };

  const service = new BotService(
    {
      async generateReply() {
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

test('price message uses gallery with a short reply', async () => {
  const service = createService({ mediaCount: 1 });
  const result = await service.processIncomingMessage('18095551234', 'precio');

  assert.equal(result.usedGallery, true);
  assert.equal(result.source, 'galeria');
  assert.ok(result.reply.split(/\s+/).length <= 15);
});

test('closing message answers with sales close', async () => {
  const service = createService();
  const result = await service.processIncomingMessage('18095551234', 'ok');

  assert.equal(result.intent, 'cierre');
  assert.equal(result.source, 'cierre');
  assert.match(result.reply.toLowerCase(), /env[ií]o hoy|dejo listo/);
});

test('hot lead message marks the conversation as hot', async () => {
  const service = createService();
  const result = await service.processIncomingMessage('18095551234', 'lo quiero');

  assert.equal(result.hotLead, true);
  assert.equal(result.source, 'hot');
});

test('doubt message uses direct convincing response', async () => {
  const service = createService();
  const result = await service.processIncomingMessage('18095551234', 'funciona de verdad?');

  assert.equal(result.intent, 'duda');
  assert.equal(result.source, 'duda');
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
    lastIntent: 'HOT',
    aiReply: 'Claro, te explico un poco como funciona la pastilla y para quien va mejor.',
  });
  const result = await service.processIncomingMessage(
    '18095551234',
    'Antes explicame un poco de la pastilla',
  );

  assert.equal(result.source, 'ai');
  assert.equal(result.hotLead, false);
  assert.match(result.reply.toLowerCase(), /explico|funciona|pastilla/);
});
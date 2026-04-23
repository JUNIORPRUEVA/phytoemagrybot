import assert from 'node:assert/strict';
import test from 'node:test';

import { WhatsAppService } from '../src/whatsapp/whatsapp.service';

function createService() {
  return new WhatsAppService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  ) as any;
}

function createAudioFlowService() {
  const botService = {
    processIncomingMessage: async () => ({
      reply: 'Te ayudo ahora mismo',
      replyType: 'text',
      mediaFiles: [],
      intent: 'otro',
      hotLead: false,
      cached: false,
      usedGallery: false,
      usedMemory: false,
      source: 'ai',
    }),
  };

  const redisService = {
    get: async () => null,
    set: async () => undefined,
    setIfAbsent: async () => true,
    appendGroupedMessage: async () => false,
    consumeGroupedMessage: async () => null,
  };

  const voiceService = {
    transcribeAudio: async () => 'quiero precio',
    generateVoice: async () => ({
      buffer: Buffer.from('audio'),
      fileName: 'reply.mp3',
      mimetype: 'audio/mpeg',
    }),
  };

  const service = new WhatsAppService(
    botService as any,
    {} as any,
    {} as any,
    {} as any,
    redisService as any,
    voiceService as any,
  ) as any;

  const sentTexts: Array<{ to: string; text: string }> = [];
  const sentAudios: Array<{ to: string; options?: Record<string, unknown> }> = [];
  let rememberedVoicePreferences = 0;

  service.sendText = async (_resolved: unknown, to: string, text: string) => {
    sentTexts.push({ to, text });
  };
  service.sendAudioWithRetry = async (
    _resolved: unknown,
    to: string,
    _audio: unknown,
    options?: Record<string, unknown>,
  ) => {
    sentAudios.push({ to, options });
  };
  service.downloadMediaMessage = async () => ({
    buffer: Buffer.from('ogg-data'),
    fileName: 'audio.ogg',
    mimetype: 'audio/ogg',
  });
  service.rememberVoiceReplyPreference = async () => {
    rememberedVoicePreferences += 1;
  };

  return {
    service,
    botService,
    redisService,
    voiceService,
    sentTexts,
    sentAudios,
    getRememberedVoicePreferences: () => rememberedVoicePreferences,
  };
}

function createResolvedConfig() {
  return {
    config: {
      openaiKey: 'sk-openai',
      elevenlabsKey: 'sk-eleven',
      botSettings: {
        allowAudioReplies: true,
      },
    },
    whatsapp: {
      fallbackMessage: 'fallback',
      audioVoiceId: 'voice-id',
      elevenLabsBaseUrl: 'https://api.elevenlabs.io',
      instanceName: 'demo',
      apiBaseUrl: 'https://evolution.example.com',
      apiKey: 'evolution-key',
      webhookSecret: 'secret',
    },
  } as any;
}

test('looksLikeMessageWebhook only accepts messages.upsert payloads', () => {
  const service = createService();

  assert.equal(
    service.looksLikeMessageWebhook({
      event: 'messages.upsert',
      data: { message: { conversation: 'hola' } },
    }),
    true,
  );

  assert.equal(
    service.looksLikeMessageWebhook({
      event: 'messages.update',
      data: { message: { conversation: 'hola' } },
    }),
    false,
  );
});

test('normalizeWebhookPayload extracts contactId and text from messages.upsert', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '18095551234@s.whatsapp.net',
        fromMe: false,
        id: 'abc123',
      },
      message: {
        conversation: 'precio',
      },
      messageType: 'conversation',
    },
  });

  assert.equal(result?.number, '18095551234');
  assert.equal(result?.message, 'precio');
  assert.equal(result?.type, 'text');
});

test('normalizeWebhookPayload accepts direct webhook payload shape', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload({
    event: 'messages.upsert',
    key: {
      remoteJid: '18095551234@s.whatsapp.net',
      fromMe: false,
      id: 'direct-123',
    },
    message: {
      extendedTextMessage: {
        text: 'quiero info',
      },
    },
    messageType: 'extendedTextMessage',
  });

  assert.equal(result?.number, '18095551234');
  assert.equal(result?.message, 'quiero info');
  assert.equal(result?.type, 'text');
});

test('normalizeWebhookPayload ignores outbound and unsupported events', () => {
  const service = createService();

  assert.equal(
    service.normalizeWebhookPayload({
      event: 'connection.update',
      data: {
        key: { remoteJid: '18095551234@s.whatsapp.net', fromMe: false },
        message: { conversation: 'hola' },
      },
    }),
    null,
  );

  assert.equal(
    service.normalizeWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '18095551234@s.whatsapp.net', fromMe: true },
        message: { conversation: 'hola' },
      },
    }),
    null,
  );
});

test('validateWebhook requires the configured secret when present', () => {
  const service = createService();

  assert.throws(() => {
    service.validateWebhook({}, { webhookSecret: 'secret' });
  });

  assert.throws(() => {
    service.validateWebhook({ 'x-webhook-secret': 'bad' }, { webhookSecret: 'secret' });
  });

  assert.doesNotThrow(() => {
    service.validateWebhook({ 'x-webhook-secret': 'secret' }, { webhookSecret: 'secret' });
  });
});

test('normalizeWebhookPayload extracts audio metadata from inbound voice notes', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '18095551234@s.whatsapp.net',
        fromMe: false,
        id: 'voice-123',
      },
      pushName: 'Cliente Voz',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          directPath: '/voice/path',
          mediaKey: 'media-key',
          seconds: 18,
          ptt: true,
        },
      },
      messageType: 'audioMessage',
    },
  });

  assert.equal(result?.type, 'audio');
  assert.equal(result?.pushName, 'Cliente Voz');
  assert.equal(result?.audio?.mimetype, 'audio/ogg; codecs=opus');
  assert.equal(result?.audio?.directPath, '/voice/path');
  assert.equal(result?.audio?.mediaKey, 'media-key');
  assert.equal(result?.audio?.seconds, 18);
  assert.equal(result?.audio?.ptt, true);
});

test('normalizeWebhookPayload prefers remoteJidAlt for lid conversations', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '69132011749577@lid',
        remoteJidAlt: '18095551234@s.whatsapp.net',
        fromMe: false,
        id: 'lid-123',
      },
      message: {
        conversation: 'hola desde lid',
      },
      messageType: 'conversation',
    },
  });

  assert.equal(result?.number, '18095551234');
  assert.equal(result?.message, 'hola desde lid');
});

test('normalizeWebhookPayload ignores group-like identifiers without a real sender jid', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '120363382457717265@g.us',
        fromMe: false,
        id: 'group-123',
      },
      message: {
        conversation: 'hola grupo',
      },
      messageType: 'conversation',
    },
  });

  assert.equal(result, null);
});

test('normalizeNumber removes lid and non digits', () => {
  const service = createService();

  assert.equal(service.normalizeNumber('69132011749577@lid'), '69132011749577');
  assert.equal(service.normalizeNumber('120363382457717265@g.us'), '120363382457717265');
  assert.equal(service.normalizeNumber('18095551234@s.whatsapp.net'), '18095551234');
});

test('executeEvolutionRequest requires a configured instance name', async () => {
  const service = createService();

  await assert.rejects(
    async () => service.executeEvolutionRequest(
      {
        whatsapp: {
          instanceName: '',
          apiBaseUrl: 'https://evolution.example.com',
          apiKey: 'evolution-key',
        },
      },
      'sendText',
      '/message/sendText/demo',
      { number: '18095551234', text: 'hola' },
    ),
    /Instance name is required/,
  );
});

test('setWebhook requests rich Evolution payload options and broad events', async () => {
  const service = createService();
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];

  service.resolveConfig = async () => createResolvedConfig();
  service.getEvolutionClient = () => ({
    post: async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body });
      return { data: { ok: true } };
    },
  });
  service.getEvolutionWebhookMetadata = async () => ({
    enabled: true,
    url: 'https://example.com/webhook',
    events: ['MESSAGES_UPSERT', 'CONTACTS_UPSERT'],
  });

  const result = await service.setWebhook('demo', 'https://example.com/webhook');

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, '/webhook/set/demo');
  assert.deepEqual(calls[0]?.body, {
    webhook: {
      enabled: true,
      url: 'https://example.com/webhook',
      headers: {
        'x-webhook-secret': 'secret',
      },
      events: [
        'MESSAGES_UPSERT',
        'MESSAGES_SET',
        'MESSAGES_UPDATE',
        'MESSAGES_DELETE',
        'MESSAGES_EDITED',
        'SEND_MESSAGE',
        'CONTACTS_SET',
        'CONTACTS_UPSERT',
        'CONTACTS_UPDATE',
        'CHATS_SET',
        'CHATS_UPSERT',
        'CHATS_UPDATE',
        'CHATS_DELETE',
        'PRESENCE_UPDATE',
        'CONNECTION_UPDATE',
        'GROUPS_UPSERT',
        'GROUP_UPDATE',
        'GROUP_PARTICIPANTS_UPDATE',
        'CALL',
      ],
      byEvents: false,
      base64: true,
    },
  });
  assert.equal(result.instanceName, 'demo');
  assert.equal(result.webhook, 'https://example.com/webhook');
});

test('onModuleInit reapplies the configured webhook when instance and url are present', async () => {
  const service = createService();
  const calls: Array<{ name: string; webhook: string }> = [];

  service.resolveConfig = async () => ({
    config: {},
    whatsapp: {
      instanceName: 'demo',
      webhookUrl: 'https://example.com/webhook',
    },
  });
  service.setWebhook = async (name: string, webhook?: string) => {
    calls.push({ name, webhook: webhook || '' });

    return {
      instanceName: name,
      webhook: webhook || '',
      events: [],
      message: 'ok',
    };
  };

  await service.onModuleInit();

  assert.deepEqual(calls, [{ name: 'demo', webhook: 'https://example.com/webhook' }]);
});

test('sendText uses instance endpoint with jid number payload', async () => {
  const service = createService();
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];

  service.createEvolutionClient = () => ({
    post: async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body });

      return { data: { ok: true } };
    },
  });

  await service.sendText(createResolvedConfig(), '18095551234@s.whatsapp.net', 'hola');

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, '/message/sendText/demo');
  assert.deepEqual(calls[0]?.body, {
    number: '18095551234@s.whatsapp.net',
    text: 'hola',
  });
});

test('sendText rejects lid jid payloads for outbound sends', async () => {
  const service = createService();

  await assert.rejects(
    service.sendText(createResolvedConfig(), '69132011749577@lid', 'hola lid'),
    /JID invalido para envio/,
  );
});

test('normalizeWebhookPayload prefers senderPn over remoteJid for direct chats when both differ', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '18295344286@s.whatsapp.net',
        senderPn: '18295319442@s.whatsapp.net',
        fromMe: false,
        id: 'senderpn-123',
      },
      message: {
        conversation: 'hola real',
      },
      messageType: 'conversation',
    },
  });

  assert.equal(result?.number, '18295319442');
  assert.equal(result?.outboundAddress, '18295319442@s.whatsapp.net');
  assert.equal(result?.message, 'hola real');
});

test('normalizeWebhookPayload falls back to remoteJid when senderPn is the instance phone', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '18295319442@s.whatsapp.net',
          senderPn: '18295344286@s.whatsapp.net',
          fromMe: false,
          id: 'remotej-fallback-123',
        },
        message: {
          conversation: 'hola remoto real',
        },
        messageType: 'conversation',
      },
    },
    '18295344286',
  );

  assert.equal(result?.number, '18295319442');
  assert.equal(result?.message, 'hola remoto real');
});

test('normalizeWebhookPayload uses senderPn when remoteJid is a group identifier', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '120363382457717265@g.us',
        senderPn: '18295319442@s.whatsapp.net',
        fromMe: false,
        id: 'group-senderpn-123',
      },
      message: {
        conversation: 'hola grupo real',
      },
      messageType: 'conversation',
    },
  });

  assert.equal(result?.number, '18295319442');
  assert.equal(result?.message, 'hola grupo real');
});

test('normalizeWebhookPayload uses participantAlt when senderPn is missing and remoteJid is the instance phone', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '18295344286@s.whatsapp.net',
          participantAlt: '18295319442@s.whatsapp.net',
          fromMe: false,
          id: 'participantalt-123',
        },
        message: {
          conversation: 'hola por participantAlt',
        },
        messageType: 'conversation',
      },
    },
    '18295344286',
  );

  assert.equal(result?.number, '18295319442');
  assert.equal(result?.message, 'hola por participantAlt');
});

test('normalizeWebhookPayload prioritizes participant when it contains a real jid', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '69132011749577@lid',
        participant: '18095551234@s.whatsapp.net',
        fromMe: false,
        id: 'participant-real-123',
      },
      message: {
        conversation: 'hola participant',
      },
      messageType: 'conversation',
    },
  });

  assert.equal(result?.number, '18095551234');
  assert.equal(result?.outboundAddress, '18095551234@s.whatsapp.net');
});

test('normalizeWebhookPayload ignores lid payloads when no real sender jid is present', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload({
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '69132011749577@lid',
        fromMe: false,
        id: 'lid-only-123',
      },
      message: {
        conversation: 'hola lid',
      },
      messageType: 'conversation',
    },
  });

  assert.equal(result, null);
});

test('normalizeWebhookPayload ignores the instance phone when resolving sender', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '18295344286@s.whatsapp.net',
          senderPn: '18095551234@s.whatsapp.net',
          fromMe: false,
          id: 'instance-phone-123',
        },
        message: {
          conversation: 'hola desde cliente',
        },
        messageType: 'conversation',
      },
    },
    '18295344286',
  );

  assert.equal(result?.number, '18095551234');
  assert.equal(result?.message, 'hola desde cliente');
});

test('normalizeWebhookPayload ignores payloads that only point to the instance phone', () => {
  const service = createService();

  const result = service.normalizeWebhookPayload(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '18295344286@s.whatsapp.net',
          senderPn: '18295344286@s.whatsapp.net',
          fromMe: false,
          id: 'self-only-123',
        },
        message: {
          conversation: 'hola self only',
        },
        messageType: 'conversation',
      },
    },
    '18295344286',
  );

  assert.equal(result, null);
});

test('enrichIncomingRecipientFromEvolution upgrades lid recipients with remoteJidAlt from Evolution messages', async () => {
  const service = createService();
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];

  service.configService = {
    get: () => undefined,
  };

  service.getEvolutionClient = () => ({
    post: async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body });

      return {
        data: {
          messages: [
            {
              key: {
                remoteJid: '69132011749577@lid',
                remoteJidAlt: '18095551234@s.whatsapp.net',
                fromMe: false,
                id: 'msg-lid-1',
              },
              message: {
                conversation: 'Holaa',
              },
              messageType: 'conversation',
            },
          ],
        },
      };
    },
  });

  const result = await service.enrichIncomingRecipientFromEvolution(
    {
      number: '69132011749577',
      outboundAddress: '69132011749577@lid',
      message: 'Holaa',
      type: 'text',
      messageId: 'msg-lid-1',
      rawPayload: {},
    },
    'demo',
    '18295344286',
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, '/chat/findMessages/demo');
  assert.deepEqual(calls[0]?.body, {
    where: {
      key: {
        id: 'msg-lid-1',
      },
    },
    page: 1,
    offset: 1,
  });
  assert.equal(result.number, '18095551234');
  assert.equal(result.outboundAddress, '18095551234@s.whatsapp.net');
});

test('processAndDeliverMessage skips replies when no valid jid is available', async () => {
  const { service, sentTexts } = createAudioFlowService();

  await service.processAndDeliverMessage(
    createResolvedConfig(),
    '18095551234',
    'hola',
    'text',
    { outboundAddress: '69132011749577@lid' },
  );

  assert.equal(sentTexts.length, 0);
});

test('enrichWebhookPayloadFromEvolution merges missing lid fields into the inbound webhook payload', async () => {
  const service = createService();
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];

  service.configService = {
    get: () => undefined,
  };

  service.getEvolutionClient = () => ({
    post: async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body });

      return {
        data: {
          messages: {
            total: 1,
            pages: 1,
            currentPage: 1,
            records: [
              {
                key: {
                  remoteJid: '69132011749577@lid',
                  remoteJidAlt: '18095551234@s.whatsapp.net',
                  participantAlt: '18095551234@s.whatsapp.net',
                  senderPn: '18095551234@s.whatsapp.net',
                  fromMe: false,
                  id: 'msg-lid-enrich-1',
                },
                message: {
                  conversation: 'Klk',
                },
                messageType: 'conversation',
              },
            ],
          },
        },
      };
    },
  });

  const result = await service.enrichWebhookPayloadFromEvolution(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '69132011749577@lid',
          fromMe: false,
          id: 'msg-lid-enrich-1',
        },
        message: {
          conversation: 'Klk',
        },
        messageType: 'conversation',
      },
      sender: '18295344286@s.whatsapp.net',
    },
    'demo',
  );

  const enrichedData = service.getWebhookMessageData(result);
  const enrichedKey = enrichedData.key;

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, '/chat/findMessages/demo');
  assert.equal(enrichedKey.remoteJidAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.participantAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.senderPn, '18095551234@s.whatsapp.net');
});

test('enrichWebhookPayloadFromEvolution falls back to contact lookup when message lookup lacks sender fields', async () => {
  const service = createService();
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];

  service.configService = {
    get: () => undefined,
  };

  service.getEvolutionClient = () => ({
    post: async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body });

      if (path === '/chat/findMessages/demo') {
        return {
          data: {
            messages: {
              total: 1,
              pages: 1,
              currentPage: 1,
              records: [
                {
                  key: {
                    remoteJid: '69132011749577@lid',
                    fromMe: false,
                    id: 'msg-lid-contact-fallback-1',
                  },
                  pushName: 'Junior Lopez',
                  message: {
                    conversation: 'Ho',
                  },
                  messageType: 'conversation',
                },
              ],
            },
          },
        };
      }

      if (path === '/chat/findContacts/demo') {
        return {
          data: {
            contacts: {
              total: 1,
              pages: 1,
              currentPage: 1,
              records: [
                {
                  remoteJid: '18095551234@s.whatsapp.net',
                  pushName: 'Junior Lopez',
                },
              ],
            },
          },
        };
      }

      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await service.enrichWebhookPayloadFromEvolution(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '69132011749577@lid',
          fromMe: false,
          id: 'msg-lid-contact-fallback-1',
        },
        pushName: 'Junior Lopez',
        message: {
          conversation: 'Ho',
        },
        messageType: 'conversation',
      },
    },
    'demo',
  );

  const enrichedData = service.getWebhookMessageData(result);
  const enrichedKey = enrichedData.key;

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.path, '/chat/findMessages/demo');
  assert.equal(calls[1]?.path, '/chat/findContacts/demo');
  assert.equal(enrichedKey.remoteJidAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.participantAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.senderPn, '18095551234@s.whatsapp.net');
});

test('attachWebhookRoutingMetadata exposes distinct sender and recipient numbers in the webhook payload', () => {
  const service = createService();

  const result = service.attachWebhookRoutingMetadata(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '69132011749577@lid',
          remoteJidAlt: '18095551234@s.whatsapp.net',
          fromMe: false,
          id: 'routing-meta-1',
        },
        pushName: 'Junior Lopez',
        message: {
          conversation: 'Ho',
        },
        messageType: 'conversation',
      },
    },
    '18295344286@s.whatsapp.net',
  );

  const enrichedData = service.getWebhookMessageData(result);

  assert.equal(result.senderNumber, '18095551234');
  assert.equal(result.senderAddress, '18095551234@s.whatsapp.net');
  assert.equal(result.recipientNumber, '18295344286');
  assert.equal(result.recipientAddress, '18295344286@s.whatsapp.net');
  assert.equal(enrichedData.senderNumber, '18095551234');
  assert.equal(enrichedData.senderAddress, '18095551234@s.whatsapp.net');
  assert.equal(enrichedData.recipientNumber, '18295344286');
  assert.equal(enrichedData.recipientAddress, '18295344286@s.whatsapp.net');
  assert.notEqual(result.senderNumber, result.recipientNumber);
});

test('getInstancePhoneNumber refreshes from evolution when local phone is missing', async () => {
  const service = createService();

  service.prisma = {
    whatsAppInstance: {
      findUnique: async () => ({ phone: null }),
    },
  };
  service.syncInstanceFromEvolution = async () => ({
    phone: '18295344286',
  });

  const phone = await service.getInstancePhoneNumber('demo');

  assert.equal(phone, '18295344286');
});

test('createInstance syncs Evolution state before validating local connected instances', async () => {
  const service = createService();
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const upsertCalls: Array<{ where: { name: string }; update: Record<string, unknown>; create: Record<string, unknown> }> = [];

  service.prisma = {
    whatsAppInstance: {
      findUnique: async () => null,
      findFirst: async ({ where }: { where: { status: string } }) =>
        where.status === 'connected' ? null : null,
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: { name: string };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) => {
        upsertCalls.push({ where, update, create });
        return {
          id: 1,
          name: create.name,
          status: create.status,
          phone: create.phone,
        };
      },
    },
  };
  let syncCalls = 0;
  service.syncInstancesFromEvolution = async () => {
    syncCalls += 1;
  };
  service.getEvolutionClient = () => ({
    post: async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body });
      return { data: { instance: { instanceName: 'demo-new' } } };
    },
  });
  service.waitForManagedStatus = async (name: string) => ({
    id: 1,
    name,
    displayName: null,
    status: 'connecting',
    phone: null,
    connected: false,
    webhookReady: false,
    webhookTarget: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const result = await service.createInstance('demo-new', {
    phone: '8090000000',
  });

  assert.equal(syncCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, '/instance/create');
  assert.deepEqual(upsertCalls, [
    {
      where: { name: 'demo-new' },
      update: { phone: '8090000000' },
      create: {
        name: 'demo-new',
        status: 'connecting',
        phone: '8090000000',
      },
    },
  ]);
  assert.equal(result.name, 'demo-new');
});

test('normalizeWebhookEvents converts legacy aliases to Evolution supported enums', () => {
  const service = createService();

  assert.deepEqual(service.normalizeWebhookEvents(['send.message.update', 'groups.update']), [
    'SEND_MESSAGE',
    'GROUP_UPDATE',
  ]);
});

test('deleteInstance clears configured instance when removing the active one', async () => {
  const service = createService();
  let deletedName = '';
  const clearedInstanceNames: string[] = [];

  service.prisma = {
    whatsAppInstance: {
      findUnique: async () => ({ name: 'demo-active' }),
      delete: async ({ where }: { where: { name: string } }) => {
        deletedName = where.name;
        return { name: where.name };
      },
    },
    whatsAppSettings: {
      updateMany: async ({ where }: { where: { instanceName: string } }) => {
        clearedInstanceNames.push(where.instanceName);
        return { count: 1 };
      },
    },
  };
  service.getEvolutionClient = () => ({
    delete: async () => ({ data: { ok: true } }),
  });

  const result = await service.deleteInstance('demo-active');

  assert.equal(deletedName, 'demo-active');
  assert.deepEqual(clearedInstanceNames, ['demo-active']);
  assert.equal(result.name, 'demo-active');
});

test('extractPhone accepts Evolution wuid and ownerJid variants', () => {
  const service = createService();

  assert.equal(
    service.extractPhone({
      wuid: '18295344286@s.whatsapp.net',
    }),
    '18295344286@s.whatsapp.net',
  );

  assert.equal(
    service.extractPhone({
      instanceData: {
        ownerJid: '18295344286@s.whatsapp.net',
      },
    }),
    '18295344286@s.whatsapp.net',
  );

  assert.equal(
    service.extractPhone({
      instance: {
        me: {
          id: '18295344286@s.whatsapp.net',
        },
      },
    }),
    '18295344286@s.whatsapp.net',
  );
});

test('processIncomingAudioMessage answers short audios as text', async () => {
  const { service, sentTexts, sentAudios } = createAudioFlowService();

  await service.processIncomingAudioMessage(createResolvedConfig(), {
    number: '18095551234',
    outboundAddress: '18095551234@s.whatsapp.net',
    message: '[audio]',
    type: 'audio',
    messageId: 'short-audio',
    audio: {
      mimetype: 'audio/ogg; codecs=opus',
      seconds: 5,
      ptt: true,
    },
    rawPayload: {},
  });

  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0]?.to, '18095551234@s.whatsapp.net');
  assert.equal(sentTexts[0]?.text, 'Te ayudo ahora mismo');
  assert.equal(sentAudios.length, 0);
});

test('processIncomingAudioMessage answers long audios as voice notes', async () => {
  const { service, sentTexts, sentAudios } = createAudioFlowService();

  await service.processIncomingAudioMessage(createResolvedConfig(), {
    number: '18095551234',
    outboundAddress: '18095551234@s.whatsapp.net',
    message: '[audio]',
    type: 'audio',
    messageId: 'long-audio',
    audio: {
      mimetype: 'audio/ogg; codecs=opus',
      seconds: 28,
      ptt: true,
    },
    rawPayload: {},
  });

  assert.equal(sentTexts.length, 0);
  assert.equal(sentAudios.length, 1);
  assert.equal(sentAudios[0]?.options?.ptt, true);
});

test('processIncomingAudioMessage rejects audios longer than 60 seconds', async () => {
  const { service, sentTexts, sentAudios, voiceService, getRememberedVoicePreferences } = createAudioFlowService();

  await service.processIncomingAudioMessage(createResolvedConfig(), {
    number: '18095551234',
    outboundAddress: '18095551234@s.whatsapp.net',
    message: '[audio]',
    type: 'audio',
    messageId: 'too-long-audio',
    audio: {
      mimetype: 'audio/ogg; codecs=opus',
      seconds: 75,
      ptt: true,
    },
    rawPayload: {},
  });

  assert.equal(sentTexts.length, 1);
  assert.match(sentTexts[0]?.text ?? '', /60 segundos/i);
  assert.equal(sentAudios.length, 0);
  assert.equal(typeof voiceService.transcribeAudio, 'function');
  assert.equal(getRememberedVoicePreferences(), 0);
});

test('processMessageWebhook ignores duplicate inbound message ids', async () => {
  const { service, redisService } = createAudioFlowService();
  let audioProcessCalls = 0;

  let dedupCalls = 0;
  redisService.setIfAbsent = async () => {
    dedupCalls += 1;
    return dedupCalls === 1;
  };

  service.resolveConfig = async () => createResolvedConfig();
  service.validateWebhook = () => undefined;
  service.normalizeWebhookPayload = () => ({
    number: '18095551234',
    outboundAddress: '69132011749577@lid',
    message: '[audio]',
    type: 'audio',
    messageId: 'duplicate-audio',
    audio: {
      mimetype: 'audio/ogg; codecs=opus',
      seconds: 22,
      ptt: true,
    },
    rawPayload: {},
  });
  service.processIncomingAudioMessage = async () => {
    audioProcessCalls += 1;
  };

  await service.processMessageWebhook({}, {});
  await service.processMessageWebhook({}, {});

  assert.equal(audioProcessCalls, 1);
});

test('processIncomingAudioMessage only remembers voice preference after success', async () => {
  const { service, voiceService, getRememberedVoicePreferences } = createAudioFlowService();

  voiceService.transcribeAudio = async () => {
    throw new Error('stt failed');
  };

  await service.processIncomingAudioMessage(createResolvedConfig(), {
    number: '18095551234',
    outboundAddress: '18095551234@s.whatsapp.net',
    message: '[audio]',
    type: 'audio',
    messageId: 'failed-audio',
    audio: {
      mimetype: 'audio/ogg; codecs=opus',
      seconds: 20,
      ptt: true,
    },
    rawPayload: {},
  });

  assert.equal(getRememberedVoicePreferences(), 0);
});
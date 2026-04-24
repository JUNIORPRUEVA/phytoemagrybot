import assert from 'node:assert/strict';
import test from 'node:test';

import { WhatsAppService } from '../src/whatsapp/whatsapp.service';

function createService() {
  const followupService = {
    registerUserReply: async () => undefined,
    registerBotReply: async () => undefined,
  };

  return new WhatsAppService(
    {} as any,
    {} as any,
    {} as any,
    followupService as any,
    {} as any,
    {} as any,
    {} as any,
  ) as any;
}

function createAudioFlowService() {
  const botService: any = {
    processIncomingMessage: async () => ({
      reply: 'Te ayudo ahora mismo',
      replyType: 'text',
      mediaFiles: [],
      intent: 'otro',
      decisionIntent: 'curioso',
      stage: 'curioso',
      action: 'guiar',
      purchaseIntentScore: 0,
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
    prepareSpokenReply: async ({ text }: { text: string }) => text,
    generateVoice: async () => ({
      buffer: Buffer.from('audio'),
      fileName: 'reply.mp3',
      mimetype: 'audio/mpeg',
    }),
  };

  const followupService = {
    registerUserReply: async () => undefined,
    registerBotReply: async () => undefined,
  };

  const service = new WhatsAppService(
    botService as any,
    {} as any,
    {} as any,
    followupService as any,
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

  assert.equal(
    service.looksLikeMessageWebhook({
      event: 'messages.upsert',
      data: {
        message: {
          reactionMessage: {
            text: '❤️',
          },
        },
        messageType: 'reactionMessage',
      },
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

  assert.equal(
    service.normalizeWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '120363382457717265@g.us',
          participant: '199028952297530@lid',
          fromMe: false,
          id: 'reaction-123',
        },
        message: {
          reactionMessage: {
            key: {
              remoteJid: '120363382457717265@g.us',
              participant: '265794101493954@lid',
            },
            text: '❤️',
          },
        },
        messageType: 'reactionMessage',
      },
      sender: '18295344286@s.whatsapp.net',
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

test('setWebhook posts the backend webhook for messages.upsert and validates the instance', async () => {
  const service = createService();
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];

  service.prisma = {
    whatsAppInstance: {
      findUnique: async ({ where }: { where: { name: string } }) =>
        where.name === 'demo' ? { name: 'demo' } : null,
    },
  };
  service.getEvolutionClient = () => ({
    post: async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body });
      return { data: { ok: true } };
    },
  });
  service.getEvolutionWebhookMetadata = async () => ({
    enabled: true,
    url: 'https://ai-business-platform-phytoemagrybot-backend.onqyr1.easypanel.host/webhook/whatsapp',
    events: ['MESSAGES_UPSERT'],
  });

  const result = await service.setWebhook('demo');

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, '/webhook/set/demo');
  assert.deepEqual(calls[0]?.body, {
    webhook: {
      enabled: true,
      url: 'https://ai-business-platform-phytoemagrybot-backend.onqyr1.easypanel.host/webhook/whatsapp',
      events: ['MESSAGES_UPSERT'],
      byEvents: false,
      base64: true,
    },
  });
  assert.equal(result.instanceName, 'demo');
  assert.equal(
    result.webhook,
    'https://ai-business-platform-phytoemagrybot-backend.onqyr1.easypanel.host/webhook/whatsapp',
  );
});

test('createInstance configures the webhook after creating the instance', async () => {
  const service = createService();
  const webhookCalls: string[] = [];

  service.prisma = {
    whatsAppInstance: {
      findUnique: async () => null,
      findFirst: async ({ where }: { where: { status: string } }) =>
        where.status === 'connected' ? null : null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => ({
        id: 1,
        name: create.name,
        status: create.status,
        phone: create.phone,
      }),
    },
  };
  service.syncInstancesFromEvolution = async () => undefined;
  service.getEvolutionClient = () => ({
    post: async () => ({ data: { instance: { instanceName: 'demo-new' } } }),
  });
  service.setWebhook = async (name: string) => {
    webhookCalls.push(name);
    return {
      instanceName: name,
      webhook: 'https://ai-business-platform-phytoemagrybot-backend.onqyr1.easypanel.host/webhook/whatsapp',
      events: ['MESSAGES_UPSERT'],
      message: 'ok',
    };
  };
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

  await service.createInstance('demo-new', {
    phone: '8090000000',
  });

  assert.deepEqual(webhookCalls, ['demo-new']);
});

test('createInstance continues when automatic webhook setup fails', async () => {
  const service = createService();

  service.prisma = {
    whatsAppInstance: {
      findUnique: async () => null,
      findFirst: async () => null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => ({
        id: 1,
        name: create.name,
        status: create.status,
        phone: create.phone,
      }),
    },
  };
  service.syncInstancesFromEvolution = async () => undefined;
  service.getEvolutionClient = () => ({
    post: async () => ({ data: { instance: { instanceName: 'demo-new' } } }),
  });
  service.setWebhook = async () => {
    throw new Error('Bad Request');
  };
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

  assert.equal(result.name, 'demo-new');
});

test('connectInstance configures the webhook after requesting the QR', async () => {
  const service = createService();
  const webhookCalls: string[] = [];

  service.getInstanceStatus = async (name: string) => ({
    id: 1,
    name,
    displayName: null,
    status: 'disconnected',
    phone: null,
    connected: false,
    webhookReady: false,
    webhookTarget: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  service.getEvolutionClient = () => ({
    get: async () => ({
      data: {
        base64: 'qr-demo',
      },
    }),
  });
  service.setWebhook = async (name: string) => {
    webhookCalls.push(name);
    return {
      instanceName: name,
      webhook: 'https://ai-business-platform-phytoemagrybot-backend.onqyr1.easypanel.host/webhook/whatsapp',
      events: ['MESSAGES_UPSERT'],
      message: 'ok',
    };
  };

  const result = await service.connectInstance('demo');

  assert.equal(result.instanceName, 'demo');
  assert.equal(result.qrCode, null);
  assert.deepEqual(webhookCalls, ['demo']);
});

test('connectInstance continues when automatic webhook setup fails', async () => {
  const service = createService();

  service.getInstanceStatus = async (name: string) => ({
    id: 1,
    name,
    displayName: null,
    status: 'disconnected',
    phone: null,
    connected: false,
    webhookReady: false,
    webhookTarget: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  service.getEvolutionClient = () => ({
    get: async () => ({
      data: {
        base64: 'qr-demo',
      },
    }),
  });
  service.setWebhook = async () => {
    throw new Error('Bad Request');
  };

  const result = await service.connectInstance('demo');

  assert.equal(result.instanceName, 'demo');
  assert.equal(result.qrCodeBase64, 'qr-demo');
});

test('getQr returns a textual QR when Evolution does not send image base64', async () => {
  const service = createService();

  service.getInstanceStatus = async (name: string) => ({
    id: 1,
    name,
    displayName: null,
    status: 'disconnected',
    phone: null,
    connected: false,
    webhookReady: false,
    webhookTarget: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  service.getEvolutionClient = () => ({
    get: async () => ({
      data: {
        code: '2@LOCAL_QR_TOKEN',
      },
    }),
  });

  const result = await service.getQr('demo');

  assert.equal(result.instanceName, 'demo');
  assert.equal(result.qrCode, '2@LOCAL_QR_TOKEN');
  assert.equal(result.qrCodeBase64, null);
  assert.equal(result.message, 'QR obtenido correctamente.');
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

test('onModuleInit replaces the legacy n8n webhook with the backend webhook', async () => {
  const service = createService();
  const calls: Array<{ name: string; webhook: string }> = [];

  service.resolveConfig = async () => ({
    config: {},
    whatsapp: {
      instanceName: 'demo',
      webhookUrl: 'https://n8n-n8n.gcdndd.easypanel.host/webhook/7e488a8b-fc78-4702-bbf4-8159f7ca094e',
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

  assert.deepEqual(calls, [{
    name: 'demo',
    webhook: 'https://ai-business-platform-phytoemagrybot-backend.onqyr1.easypanel.host/webhook/whatsapp',
  }]);
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

test('attachWebhookRoutingMetadata derives recipient number from webhook sender when instance phone is unavailable', () => {
  const service = createService();

  const result = service.attachWebhookRoutingMetadata({
    event: 'messages.upsert',
    sender: '18295344286@s.whatsapp.net',
    data: {
      key: {
        remoteJid: '69132011749577@lid',
        remoteJidAlt: '18295319442@s.whatsapp.net',
        fromMe: false,
        id: 'recipient-fallback-123',
      },
      message: {
        conversation: 'hola recipient fallback',
      },
      messageType: 'conversation',
    },
  });

  assert.equal(result.recipientAddress, '18295344286@s.whatsapp.net');
  assert.equal(result.recipientNumber, '18295344286');
  assert.equal(result.data.recipientAddress, '18295344286@s.whatsapp.net');
  assert.equal(result.data.recipientNumber, '18295344286');
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
        const where = body.where as Record<string, unknown> | undefined;

        if (where?.pushName) {
          return {
            data: {
              contacts: {
                total: 0,
                pages: 0,
                currentPage: 1,
                records: [],
              },
            },
          };
        }

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

  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.path, '/chat/findMessages/demo');
  assert.equal(calls[1]?.path, '/chat/findContacts/demo');
  assert.equal(enrichedKey.remoteJidAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.participantAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.senderPn, '18095551234@s.whatsapp.net');
});

test('enrichWebhookPayloadFromEvolution resolves group participant lid through contact lookup', async () => {
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
                    remoteJid: '120363382457717265@g.us',
                    participant: '180685096620065@lid',
                    fromMe: false,
                    id: 'group-participant-lid-1',
                  },
                  pushName: 'Mayra Torres',
                  message: {
                    conversation: 'Hola grupo',
                  },
                  messageType: 'conversation',
                },
              ],
            },
          },
        };
      }

      if (path === '/chat/findContacts/demo') {
        const where = body.where as Record<string, unknown> | undefined;

        if (where?.pushName) {
          return {
            data: {
              contacts: {
                total: 0,
                pages: 0,
                currentPage: 1,
                records: [],
              },
            },
          };
        }

        return {
          data: {
            contacts: {
              total: 1,
              pages: 1,
              currentPage: 1,
              records: [
                {
                  remoteJid: '18095551234@s.whatsapp.net',
                  pushName: 'Mayra Torres',
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
          remoteJid: '120363382457717265@g.us',
          participant: '180685096620065@lid',
          fromMe: false,
          id: 'group-participant-lid-1',
        },
        pushName: 'Mayra Torres',
        message: {
          conversation: 'Hola grupo',
        },
        messageType: 'conversation',
      },
      sender: '18295344286@s.whatsapp.net',
    },
    'demo',
  );

  const enrichedData = service.getWebhookMessageData(result);
  const enrichedKey = enrichedData.key;
  const normalized = service.normalizeWebhookPayload(result, '18295344286@s.whatsapp.net');

  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.path, '/chat/findMessages/demo');
  assert.deepEqual(calls[1]?.body, {
    where: { pushName: 'Mayra Torres' },
    page: 1,
    offset: 10,
  });
  assert.deepEqual(calls[2]?.body, {
    where: { remoteJid: '180685096620065@lid' },
    page: 1,
    offset: 10,
  });
  assert.equal(enrichedKey.remoteJidAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.participantAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.participantPn, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.senderPn, '18095551234@s.whatsapp.net');
  assert.equal(normalized?.number, '18095551234');
  assert.equal(normalized?.outboundAddress, '18095551234@s.whatsapp.net');
});

test('enrichWebhookPayloadFromEvolution refuses ambiguous group participant matches without the queried lid', async () => {
  const service = createService();

  service.configService = {
    get: () => undefined,
  };

  service.getEvolutionClient = () => ({
    post: async (path: string, body: Record<string, unknown>) => {
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
                    remoteJid: '120363382457717265@g.us',
                    participant: '199028952297530@lid',
                    fromMe: false,
                    id: 'group-participant-lid-ambiguous-1',
                  },
                  pushName: 'Keyla Blanco',
                  message: {
                    audioMessage: {
                      mimetype: 'audio/ogg; codecs=opus',
                      directPath: '/voice/path',
                      mediaKey: 'media-key',
                      seconds: 27,
                      ptt: true,
                    },
                  },
                  messageType: 'audioMessage',
                },
              ],
            },
          },
        };
      }

      if (path === '/chat/findContacts/demo') {
        const where = body.where as Record<string, unknown> | undefined;

        if (where?.pushName) {
          return {
            data: {
              contacts: {
                total: 0,
                pages: 0,
                currentPage: 1,
                records: [],
              },
            },
          };
        }

        return {
          data: {
            contacts: {
              total: 1,
              pages: 1,
              currentPage: 1,
              records: [
                {
                  remoteJid: '18293526303@s.whatsapp.net',
                  pushName: 'Otra Persona',
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
          remoteJid: '120363382457717265@g.us',
          participant: '199028952297530@lid',
          fromMe: false,
          id: 'group-participant-lid-ambiguous-1',
        },
        pushName: 'Keyla Blanco',
        message: {
          audioMessage: {
            mimetype: 'audio/ogg; codecs=opus',
            directPath: '/voice/path',
            mediaKey: 'media-key',
            seconds: 27,
            ptt: true,
          },
        },
        messageType: 'audioMessage',
      },
      sender: '18295344286@s.whatsapp.net',
    },
    'demo',
  );

  const enrichedData = service.getWebhookMessageData(result);
  const enrichedKey = enrichedData.key;
  const normalized = service.normalizeWebhookPayload(result, '18295344286@s.whatsapp.net');

  assert.equal(enrichedKey.remoteJidAlt, undefined);
  assert.equal(enrichedKey.participantAlt, undefined);
  assert.equal(enrichedKey.participantPn, undefined);
  assert.equal(enrichedKey.senderPn, undefined);
  assert.equal(normalized, null);
});

test('enrichWebhookPayloadFromEvolution prefers the only real jid when contact lookup returns duplicate exact-name matches', async () => {
  const service = createService();

  service.configService = {
    get: () => undefined,
  };

  service.getEvolutionClient = () => ({
    post: async (path: string) => {
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
                    id: 'msg-lid-contact-ambiguous-1',
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
              total: 2,
              pages: 1,
              currentPage: 1,
              records: [
                {
                  remoteJid: '69132011749577@lid',
                  pushName: 'Junior Lopez',
                },
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
          id: 'msg-lid-contact-ambiguous-1',
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

  assert.equal(enrichedKey.remoteJidAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.participantAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.senderPn, '18095551234@s.whatsapp.net');
});

test('enrichWebhookPayloadFromEvolution falls back to unfiltered contacts and alternative name fields when filtered lookup misses', async () => {
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
                    id: 'msg-lid-contact-name-fallback-1',
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
        const where = body.where as Record<string, unknown> | undefined;

        if (where?.pushName) {
          return {
            data: {
              contacts: {
                total: 0,
                pages: 0,
                currentPage: 1,
                records: [],
              },
            },
          };
        }

        if (where?.remoteJid) {
          return {
            data: {
              contacts: {
                total: 0,
                pages: 0,
                currentPage: 1,
                records: [],
              },
            },
          };
        }

        return {
          data: {
            contacts: {
              total: 2,
              pages: 1,
              currentPage: 1,
              records: [
                {
                  remoteJid: '18095551234@s.whatsapp.net',
                  name: 'Junior Lopez',
                },
                {
                  remoteJid: '18885550000@s.whatsapp.net',
                  name: 'Otro Cliente',
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
          id: 'msg-lid-contact-name-fallback-1',
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

  assert.equal(calls.length, 4);
  assert.equal(calls[0]?.path, '/chat/findMessages/demo');
  assert.deepEqual(calls[1]?.body, { where: { pushName: 'Junior Lopez' }, page: 1, offset: 10 });
  assert.deepEqual(calls[2]?.body, { where: { remoteJid: '69132011749577@lid' }, page: 1, offset: 10 });
  assert.deepEqual(calls[3]?.body, { page: 1, offset: 100 });
  assert.equal(enrichedKey.remoteJidAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.participantAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.senderPn, '18095551234@s.whatsapp.net');
});

test('enrichWebhookPayloadFromKnownLid reuses cached lid mappings before contact lookup', async () => {
  const service = createService();

  service.redisService = {
    get: async (key: string) =>
      key === 'wa:lid-map:demo:69132011749577@lid'
        ? '18095551234@s.whatsapp.net'
        : null,
  };

  const result = await service.enrichWebhookPayloadFromKnownLid(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '69132011749577@lid',
          fromMe: false,
          id: 'cached-lid-1',
        },
        pushName: 'Junior Lopez',
        message: {
          conversation: 'Hola cache',
        },
        messageType: 'conversation',
      },
    },
    'demo',
  );

  const enrichedData = service.getWebhookMessageData(result);
  const enrichedKey = enrichedData.key;

  assert.equal(enrichedKey.remoteJidAlt, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.senderPn, '18095551234@s.whatsapp.net');
  assert.equal(enrichedKey.participantPn, '18095551234@s.whatsapp.net');
});

test('rememberSenderJidMapping learns lid to real jid correlations from paired outbound webhooks', async () => {
  const service = createService();
  const store = new Map<string, string>();

  service.redisService = {
    set: async (key: string, value: string) => {
      store.set(key, value);
    },
    get: async (key: string) => store.get(key) ?? null,
  };

  await service.rememberSenderJidMapping(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '69132011749577@lid',
          fromMe: true,
          id: 'paired-message-1',
        },
        message: {
          conversation: 'Klo',
        },
      },
    },
    'demo',
  );

  await service.rememberSenderJidMapping(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '18295319442@s.whatsapp.net',
          fromMe: true,
          id: 'paired-message-1',
        },
        message: {
          conversation: 'Klo',
        },
      },
    },
    'demo',
  );

  assert.equal(
    store.get('wa:lid-map:demo:69132011749577@lid'),
    '18295319442@s.whatsapp.net',
  );
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
  const webhookCalls: string[] = [];

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
  service.setWebhook = async (name: string) => {
    webhookCalls.push(name);
    return {
      instanceName: name,
      webhook: 'https://ai-business-platform-phytoemagrybot-backend.onqyr1.easypanel.host/webhook/whatsapp',
      events: ['messages.upsert'],
      message: 'ok',
    };
  };
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
  assert.deepEqual(webhookCalls, ['demo-new']);
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

test('processIncomingAudioMessage sends text when bot replyType is text', async () => {
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
  const { service, sentTexts, sentAudios, botService } = createAudioFlowService();

  botService.processIncomingMessage = async () => ({
    reply: 'Te respondo por audio.',
    replyType: 'audio',
    mediaFiles: [],
    intent: 'otro',
    decisionIntent: 'curioso',
    stage: 'curioso',
    action: 'guiar',
    purchaseIntentScore: 0,
    hotLead: false,
    cached: false,
    usedGallery: false,
    usedMemory: false,
    source: 'ai',
  });

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

test('processAndDeliverMessage keeps text delivery even when preferAudioReply is true', async () => {
  const { service, sentTexts, sentAudios } = createAudioFlowService();

  await service.processAndDeliverMessage(
    createResolvedConfig(),
    '18095551234',
    'Hola me interesa comprar',
    'text',
    {
      preferAudioReply: true,
      outboundAddress: '18095551234@s.whatsapp.net',
    },
  );

  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0]?.text, 'Te ayudo ahora mismo');
  assert.equal(sentAudios.length, 0);
});

test('processAndDeliverMessage can send media and then a voice reply', async () => {
  const { service, sentTexts, sentAudios, botService } = createAudioFlowService();
  const deliveredMedia: string[] = [];

  botService.processIncomingMessage = async () => ({
    reply: 'Te mando las fotos y te explico por audio.',
    replyType: 'audio',
    mediaFiles: [{
      id: 1,
      title: 'producto-1',
      description: null,
      fileUrl: 'https://example.com/producto-1.jpg',
      fileType: 'image',
      createdAt: new Date(),
    }],
    intent: 'catalogo',
    decisionIntent: 'info',
    stage: 'interesado',
    action: 'guiar',
    purchaseIntentScore: 40,
    hotLead: false,
    cached: false,
    usedGallery: true,
    usedMemory: false,
    source: 'ai',
  });
  service.deliverMatchedMedia = async (
    _resolved: unknown,
    to: string,
    mediaFiles: Array<{ fileUrl: string }>,
  ) => {
    deliveredMedia.push(`${to}:${mediaFiles[0]?.fileUrl ?? ''}`);
  };

  await service.processAndDeliverMessage(
    createResolvedConfig(),
    '18095551234',
    'mandame fotos y explicamelo por audio',
    'audio',
    {
      preferAudioReply: true,
      outboundAddress: '18095551234@s.whatsapp.net',
    },
  );

  assert.equal(deliveredMedia.length, 1);
  assert.equal(sentAudios.length, 1);
  assert.equal(sentTexts.length, 0);
});

test('processAndDeliverMessage falls back to text when media delivery fails', async () => {
  const { service, sentTexts, sentAudios, botService } = createAudioFlowService();

  botService.processIncomingMessage = async () => ({
    reply: 'Te explico por aqui mientras te consigo las imagenes.',
    replyType: 'text',
    mediaFiles: [{
      id: 1,
      title: 'producto-1',
      description: null,
      fileUrl: 'https://example.com/producto-1.jpg',
      fileType: 'image',
      createdAt: new Date(),
    }],
    intent: 'catalogo',
    decisionIntent: 'info',
    stage: 'interesado',
    action: 'guiar',
    purchaseIntentScore: 40,
    hotLead: false,
    cached: false,
    usedGallery: true,
    usedMemory: false,
    source: 'ai',
  });
  service.deliverMatchedMedia = async () => {
    throw new Error('media send failed');
  };

  await service.processAndDeliverMessage(
    createResolvedConfig(),
    '18095551234',
    'mandame fotos',
    'text',
    {
      outboundAddress: '18095551234@s.whatsapp.net',
    },
  );

  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0]?.text, 'Te explico por aqui mientras te consigo las imagenes.');
  assert.equal(sentAudios.length, 0);
});

test('prepareReplyForVoice removes emojis and leaves spoken punctuation', () => {
  const service = createService();

  const result = service.prepareReplyForVoice('Perfecto 👍 te lo dejo listo, ¿te lo envío hoy?');

  assert.equal(result.includes('👍'), false);
  assert.match(result, /^Perfecto,/);
  assert.match(result, /\?$/);
});

test('processAndDeliverMessage rewrites the text before generating voice', async () => {
  const { service, voiceService, botService } = createAudioFlowService();
  let preparedText = '';

  botService.processIncomingMessage = async () => ({
    reply: 'Te ayudo ahora mismo',
    replyType: 'audio',
    mediaFiles: [],
    intent: 'otro',
    decisionIntent: 'curioso',
    stage: 'curioso',
    action: 'guiar',
    purchaseIntentScore: 0,
    hotLead: false,
    cached: false,
    usedGallery: false,
    usedMemory: false,
    source: 'ai',
  });

  voiceService.prepareSpokenReply = async ({ text }: { text: string }) => {
    preparedText = text;
    return 'Claro, te explico un poco mejor como funciona.';
  };

  await service.processAndDeliverMessage(
    createResolvedConfig(),
    '18095551234',
    'explicame por voz',
    'audio',
    {
      preferAudioReply: true,
      outboundAddress: '18095551234@s.whatsapp.net',
    },
  );

  assert.match(preparedText, /te ayudo ahora mismo|claro|perfecto/i);
});

test('processAndDeliverMessage retries text delivery after a transient send failure', async () => {
  const { service, sentTexts } = createAudioFlowService();
  let attempts = 0;

  service.sendText = async (_resolved: unknown, to: string, text: string) => {
    attempts += 1;

    if (attempts === 1) {
      throw new Error('temporary failure');
    }

    sentTexts.push({ to, text });
  };

  await service.processAndDeliverMessage(
    createResolvedConfig(),
    '18095551234',
    'hola',
    'text',
    {
      outboundAddress: '18095551234@s.whatsapp.net',
    },
  );

  assert.equal(attempts, 2);
  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0]?.text, 'Te ayudo ahora mismo');
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

test('processMessageWebhook ignores outbound fromMe payloads before enrichment', async () => {
  const service = createService();
  let enrichCalls = 0;
  let normalizeCalls = 0;

  service.resolveConfig = async () => createResolvedConfig();
  service.validateWebhook = () => undefined;
  service.enrichWebhookPayloadFromEvolution = async () => {
    enrichCalls += 1;
    return {};
  };
  service.normalizeWebhookPayload = () => {
    normalizeCalls += 1;
    return null;
  };

  await service.processMessageWebhook(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '18295319442@s.whatsapp.net',
          fromMe: true,
          id: 'fromme-123',
        },
        message: {
          conversation: 'hola saliente',
        },
      },
    },
    {},
  );

  assert.equal(enrichCalls, 0);
  assert.equal(normalizeCalls, 0);
});

test('acceptWebhook returns a trace id for inbound message processing', async () => {
  const service = createService();

  service.processConnectionUpdate = async () => false;
  service.looksLikeMessageWebhook = () => true;
  service.processMessageWebhook = async () => undefined;

  const result = await service.acceptWebhook(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '18095551234@s.whatsapp.net',
          fromMe: false,
          id: 'trace-accept-1',
        },
        message: {
          conversation: 'hola trace',
        },
      },
    },
    {},
  );

  assert.equal(result.accepted, true);
  assert.match(result.traceId ?? '', /^[0-9a-f-]{36}$/i);
});

test('acceptWebhook ignores group reaction payloads without triggering bot replies', async () => {
  let botCalls = 0;
  const sentTexts: Array<{ to: string; text: string }> = [];
  const sentAudios: Array<{ to: string; options?: Record<string, unknown> }> = [];

  const service = new WhatsAppService(
    {
      processIncomingMessage: async () => {
        botCalls += 1;
        return {
          reply: 'respuesta inesperada',
          replyType: 'text',
          mediaFiles: [],
          intent: 'otro',
          decisionIntent: 'curioso',
          stage: 'curioso',
          action: 'guiar',
          purchaseIntentScore: 0,
          hotLead: false,
          cached: false,
          usedGallery: false,
          usedMemory: false,
          source: 'ai',
        };
      },
    } as any,
    {} as any,
    {} as any,
    {
      registerUserReply: async () => undefined,
      registerBotReply: async () => undefined,
    } as any,
    {} as any,
    {
      get: async () => null,
      set: async () => undefined,
      setIfAbsent: async () => true,
      appendGroupedMessage: async () => false,
      consumeGroupedMessage: async () => null,
    } as any,
    {
      transcribeAudio: async () => 'irrelevante',
      generateVoice: async () => ({
        buffer: Buffer.from('audio'),
        fileName: 'reply.mp3',
        mimetype: 'audio/mpeg',
      }),
    } as any,
  ) as any;

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

  const result = await service.acceptWebhook(
    {
      event: 'messages.upsert',
      instance: 'demo',
      sender: '18295344286@s.whatsapp.net',
      data: {
        key: {
          remoteJid: '120363382457717265@g.us',
          fromMe: false,
          id: 'reaction-group-accept-1',
          participant: '199028952297530@lid',
        },
        pushName: 'Keyla Blanco',
        status: 'DELIVERY_ACK',
        message: {
          reactionMessage: {
            key: {
              remoteJid: '120363382457717265@g.us',
              fromMe: false,
              id: 'reaction-origin-1',
              participant: '265794101493954@lid',
            },
            text: '❤️',
            senderTimestampMs: '1776947609442',
          },
        },
        messageType: 'reactionMessage',
      },
    },
    {},
  );

  assert.equal(result.ignored, true);
  assert.match(result.traceId ?? '', /^[0-9a-f-]{36}$/i);
  assert.equal(botCalls, 0);
  assert.deepEqual(sentTexts, []);
  assert.deepEqual(sentAudios, []);
});

test('processMessageWebhook emits precise routing diagnostics when recipient data is missing', async () => {
  const service = createService();
  const warnings: Array<Record<string, unknown>> = [];

  service.logger = {
    log: () => undefined,
    warn: (message: string) => {
      warnings.push(JSON.parse(message) as Record<string, unknown>);
    },
    error: () => undefined,
  };
  service.resolveConfig = async () => createResolvedConfig();
  service.validateWebhook = () => undefined;
  service.rememberSenderJidMapping = async () => undefined;
  service.getInstancePhoneNumber = async () => null;
  service.enrichWebhookPayloadFromKnownLid = async (payload: Record<string, unknown>) => payload;
  service.enrichWebhookPayloadFromEvolution = async (payload: Record<string, unknown>) => payload;

  await service.processMessageWebhook(
    {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '69132011749577@lid',
          fromMe: false,
          id: 'missing-routing-1',
        },
        message: {
          conversation: 'hola sin ruta',
        },
        messageType: 'conversation',
      },
    },
    {},
  );

  const incompleteRouting = warnings.find(
    (entry) =>
      entry.event === 'whatsapp_pipeline_diagnostic' &&
      entry.reason === 'recipient_routing_incomplete',
  );
  const normalizeFailed = warnings.find(
    (entry) =>
      entry.event === 'whatsapp_pipeline_diagnostic' &&
      entry.reason === 'normalize_failed',
  );

  assert.ok(incompleteRouting);
  assert.ok(normalizeFailed);
  assert.deepEqual(incompleteRouting?.reasons, [
    'instance_phone_missing',
    'remote_jid_is_lid',
    'missing_sender_metadata',
    'top_level_sender_missing',
    'recipient_address_unresolved',
    'recipient_number_unresolved',
  ]);
});

test('processAndDeliverMessage logs ordered delivery stages before sending to Evolution', async () => {
  const { service } = createAudioFlowService();
  const loggedStages: string[] = [];

  service.logger = {
    log: (message: string) => {
      const payload = JSON.parse(message) as Record<string, unknown>;
      if (payload.event === 'whatsapp_delivery_stage') {
        loggedStages.push(String(payload.stage));
      }
    },
    warn: () => undefined,
    error: () => undefined,
  };

  await service.processAndDeliverMessage(
    createResolvedConfig(),
    '18095551234',
    'hola orden',
    'text',
    {
      outboundAddress: '18095551234@s.whatsapp.net',
      diagnostic: {
        traceId: 'trace-order-1',
        instanceName: 'demo',
        messageId: 'msg-order-1',
        contactId: '18095551234',
        messageType: 'text',
        remoteJid: '18095551234@s.whatsapp.net',
        recipientAddress: '18295344286@s.whatsapp.net',
        recipientNumber: '18295344286',
      },
    },
  );

  assert.deepEqual(loggedStages, [
    'ai_processing_started',
    'ai_processing_completed',
    'evolution_send_attempt',
    'evolution_send_completed',
  ]);
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
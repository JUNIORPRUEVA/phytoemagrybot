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

test('normalizeWebhookPayload preserves group jids for replies', () => {
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

  assert.equal(result?.number, '120363382457717265@g.us');
  assert.equal(result?.message, 'hola grupo');
});

test('normalizeNumber preserves special whatsapp jids and digits for direct chats', () => {
  const service = createService();

  assert.equal(service.normalizeNumber('69132011749577@lid'), '69132011749577@lid');
  assert.equal(
    service.normalizeNumber('120363382457717265@g.us'),
    '120363382457717265@g.us',
  );
  assert.equal(service.normalizeNumber('18095551234@s.whatsapp.net'), '18095551234');
});

test('processIncomingAudioMessage answers short audios as text', async () => {
  const { service, sentTexts, sentAudios } = createAudioFlowService();

  await service.processIncomingAudioMessage(createResolvedConfig(), {
    number: '18095551234',
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
  assert.equal(sentTexts[0]?.text, 'Te ayudo ahora mismo');
  assert.equal(sentAudios.length, 0);
});

test('processIncomingAudioMessage answers long audios as voice notes', async () => {
  const { service, sentTexts, sentAudios } = createAudioFlowService();

  await service.processIncomingAudioMessage(createResolvedConfig(), {
    number: '18095551234',
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
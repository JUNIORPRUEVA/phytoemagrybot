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
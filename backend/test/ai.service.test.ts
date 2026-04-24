import assert from 'node:assert/strict';
import test from 'node:test';

import { AiService } from '../src/ai/ai.service';

test('system prompt enforces internal sales analysis and dominican human tone', () => {
  const service = new AiService() as any;

  const prompt = service.buildSystemPromptFromConfig({
    fullPrompt: '',
    contactId: '18095551234',
    config: { configurations: {} },
    classifiedIntent: 'info',
    decisionAction: 'guiar',
    purchaseIntentScore: 20,
    responseStyle: 'balanced',
    leadStage: 'curioso',
    replyObjective: 'avanzar_conversacion',
  });

  assert.match(prompt, /Piensa primero y responde despues/i);
  assert.match(prompt, /Que quiere realmente el cliente/i);
  assert.match(prompt, /curioso, interesado, dudoso o listo para comprar/i);
  assert.match(prompt, /usa la memoria/i);
  assert.match(prompt, /vendedor dominicano real/i);
  assert.match(prompt, /No hables como sistema, IA, servicio automatico/i);
  assert.match(prompt, /Etapa detectada del cliente: curioso/i);
  assert.match(prompt, /Objetivo principal de esta respuesta: avanzar_conversacion/i);
  assert.match(prompt, /Intencion clasificada: info/i);
  assert.match(prompt, /Estrategia elegida: guiar/i);
  assert.match(prompt, /No repitas literalmente frases, cierres ni ideas/i);
  assert.match(prompt, /2 o 3 lineas maximo/i);
  assert.match(prompt, /Si no cumple, reescribela antes de devolverla/i);
});

test('system prompt keeps brief mode focused on direct answers', () => {
  const service = new AiService() as any;

  const prompt = service.buildSystemPromptFromConfig({
    fullPrompt: '',
    contactId: '18095551234',
    config: { configurations: {} },
    classifiedIntent: 'precio',
    decisionAction: 'responder_precio_con_valor',
    purchaseIntentScore: 40,
    responseStyle: 'brief',
    leadStage: 'interesado',
    replyObjective: 'avanzar_conversacion',
  });

  assert.match(prompt, /Modo de respuesta: breve/i);
  assert.match(prompt, /precio, disponibilidad, envio o una duda puntual/i);
});
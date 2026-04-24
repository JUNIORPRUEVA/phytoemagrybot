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
  assert.match(prompt, /completa bien la idea/i);
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
  assert.match(prompt, /no dejes frases a medias/i);
});

test('system prompt includes structured instruction center context when configured', () => {
  const service = new AiService() as any;

  const prompt = service.buildSystemPromptFromConfig({
    fullPrompt: '',
    contactId: '18095551234',
    config: {
      configurations: {
        instructions: {
          identity: {
            assistantName: 'Aura',
            role: 'Cerradora de ventas por WhatsApp',
            objective: 'Convertir conversaciones en pedidos',
            tone: 'Calida y segura',
          },
          rules: ['Nunca inventes precios', 'Siempre responde en texto'],
          salesPrompts: {
            opening: 'Rompe el hielo con contexto humano.',
            closing: 'Cierra con una accion puntual.',
          },
          products: [
            {
              name: 'Te Detox Premium',
              category: 'Infusiones',
              summary: 'Ayuda a desinflamar y mejorar digestion.',
              price: 'RD$1,500',
              cta: 'Ofrece envio hoy mismo.',
              keywords: ['detox', 'digestivo'],
            },
          ],
        },
      },
    },
    classifiedIntent: 'precio',
    decisionAction: 'responder_precio_con_valor',
    purchaseIntentScore: 55,
    responseStyle: 'balanced',
    leadStage: 'interesado',
    replyObjective: 'cerrar_suave',
  });

  assert.match(prompt, /Identidad y comportamiento del bot/i);
  assert.match(prompt, /Aura/i);
  assert.match(prompt, /Reglas del bot/i);
  assert.match(prompt, /Nunca inventes precios/i);
  assert.match(prompt, /Prompts de ventas/i);
  assert.match(prompt, /Productos disponibles/i);
  assert.match(prompt, /Te Detox Premium/i);
  assert.match(prompt, /RD\$1,500/i);
});

test('parseAssistantReply keeps full text content without truncating lines or words', () => {
  const service = new AiService() as any;
  const content =
    'Hola, claro. Te explico completo como funciona el producto, cuales beneficios tiene, como se toma, que resultados puedes esperar, el precio, el envio y como comprar hoy mismo sin dejarte nada importante fuera.';
  const longReply = JSON.stringify({
    type: 'text',
    content,
  });

  const parsed = service.parseAssistantReply(longReply);

  assert.equal(parsed.type, 'text');
  assert.equal(parsed.content, content);
});
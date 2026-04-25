import assert from 'node:assert/strict';
import test from 'node:test';

import { AiService } from '../src/ai/ai.service';

test('system prompt enforces internal sales analysis and dominican human tone', () => {
  const service = new AiService({} as any) as any;

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
  const service = new AiService({} as any) as any;

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
  const service = new AiService({} as any) as any;

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

test('system prompt enforces instructions and products as mandatory sources', () => {
  const service = new AiService({} as any) as any;

  const prompt = service.buildSystemPromptFromConfig({
    fullPrompt: '',
    contactId: '18095551234',
    config: {
      configurations: {
        instructions: {
          products: [
            {
              id: 'detox-1',
              titulo: 'Te Detox Premium',
              descripcion_corta: 'Ayuda a digestion y bienestar.',
              descripcion_completa: 'Infusion herbal para apoyar digestion y desinflamar.',
              precio: 1500,
              precio_minimo: 1300,
              imagenes: ['https://example.com/detox-1.jpg'],
              videos: ['https://example.com/detox-1.mp4'],
              activo: true,
            },
          ],
        },
      },
    },
    classifiedIntent: 'info',
    decisionAction: 'guiar',
    purchaseIntentScore: 30,
    responseStyle: 'balanced',
    leadStage: 'interesado',
    replyObjective: 'avanzar_conversacion',
  });

  assert.match(prompt, /Fuentes obligatorias antes de responder/i);
  assert.match(prompt, /Lee y obedece INSTRUCCIONES/i);
  assert.match(prompt, /Lee PRODUCTOS completos/i);
  assert.match(prompt, /imagenes o videos disponibles/i);
  assert.match(prompt, /Descripcion corta/i);
  assert.match(prompt, /Videos/i);
});

test('system prompt forces commercial replies to end with a clear next step', () => {
  const service = new AiService({} as any) as any;

  const prompt = service.buildSystemPromptFromConfig({
    fullPrompt: '',
    contactId: '18095551234',
    config: { configurations: {} },
    classifiedIntent: 'interesado',
    decisionAction: 'guiar',
    purchaseIntentScore: 45,
    responseStyle: 'balanced',
    leadStage: 'interesado',
    replyObjective: 'avanzar_conversacion',
  });

  assert.match(prompt, /termina con una accion clara para avanzar/i);
  assert.match(prompt, /te lo envio\?|cuantas quieres\?|te gustaria pedirlo\?/i);
  assert.match(prompt, /si es una respuesta comercial, termina con un siguiente paso claro/i);
});

test('parseAssistantReply keeps full text content without truncating lines or words', () => {
  const service = new AiService({} as any) as any;
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

test('parseAssistantResponses supports multi-candidate JSON payloads', () => {
  const service = new AiService({} as any) as any;
  const parsed = service.parseAssistantResponses(JSON.stringify({
    responses: [
      {
        text: 'Te explico rapido como funciona.',
        imageId: 'https://example.com/imagen-1.jpg',
        type: 'text',
      },
      {
        text: 'Si quieres, te mando un video para que lo veas mejor.',
        videoId: 'https://example.com/video-1.mp4',
        type: 'text',
      },
    ],
  }), 2);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.imageId, 'https://example.com/imagen-1.jpg');
  assert.equal(parsed[1]?.videoId, 'https://example.com/video-1.mp4');
});

test('generateResponses forwards thinkingInstruction into OpenAI messages', async () => {
  const engineMock = {
    transform: async ({ thinkingInstructionEs, contextEs, companyContextEs }: any) => {
      const xmlEn = [
        '<prompts>',
        '  <identity>Test</identity>',
        '  <sales>Test</sales>',
        '  <greeting>Test</greeting>',
        '  <media>Test</media>',
        '  <voice>Test</voice>',
        '  <stop>Test</stop>',
        `  <rules>${String(thinkingInstructionEs ?? '')}\n${String(contextEs ?? '')}</rules>`,
        '  <company>',
        `    <general>${String(companyContextEs ?? '')}</general>`,
        '    <hours>Test</hours>',
        '    <location>Test</location>',
        '    <products>Test</products>',
        '  </company>',
        '</prompts>',
      ].join('\n');

      return {
        xmlEn,
        debug: {
          original_spanish: '',
          xml_generated: '',
          translated_english: xmlEn,
        },
      };
    },
  };

  const service = new AiService(engineMock as any) as any;
  let capturedMessages: Array<{ role: string; content: string }> = [];

  service.createOpenAIClient = () => ({
    chat: {
      completions: {
        create: async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
          capturedMessages = messages;
          return {
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    responses: [
                      {
                        text: 'Te explico breve y avanzamos al siguiente paso.',
                        type: 'text',
                      },
                    ],
                  }),
                },
              },
            ],
          };
        },
      },
    },
  });

  const responses = await service.generateResponses({
    config: {
      openaiKey: 'test-key',
      configurations: {},
      aiSettings: {
        memoryWindow: 6,
        temperature: 0.4,
        maxCompletionTokens: 180,
      },
    },
    fullPrompt: 'Responde con claridad.',
    companyContext: '[EMPRESA]\nPhyto Emagry',
    contactId: '18095551234',
    message: 'y el precio entonces?',
    history: [
      { role: 'user', content: 'como funciona?' },
      { role: 'assistant', content: 'Ya te explique como funciona.' },
    ],
    context: '[THINKING_RESULT]\nalreadyExplained: true',
    classifiedIntent: 'precio',
    decisionAction: 'responder_precio_con_valor',
    purchaseIntentScore: 72,
    responseStyle: 'balanced',
    leadStage: 'interesado',
    replyObjective: 'avanzar_conversacion',
    thinkingInstruction: 'Analiza primero, luego responde sin repetir. Usa el analisis para decidir la mejor accion.',
    candidateCount: 2,
  });

  assert.equal(responses.length, 1);
  assert.ok(capturedMessages.length > 0);
  assert.equal(capturedMessages[0]?.role, 'system');
  assert.match(capturedMessages[0]?.content ?? '', /<prompts>/i);
  assert.match(capturedMessages[0]?.content ?? '', /<rules>/i);
  assert.match(capturedMessages[0]?.content ?? '', /<company>/i);
  assert.match(capturedMessages[0]?.content ?? '', /<general>/i);
  assert.match(capturedMessages[0]?.content ?? '', /<hours>/i);
  assert.match(capturedMessages[0]?.content ?? '', /<location>/i);
  assert.match(capturedMessages[0]?.content ?? '', /<products>/i);
  assert.match(capturedMessages[0]?.content ?? '', /Analiza primero, luego responde sin repetir/i);
  assert.match(capturedMessages[0]?.content ?? '', /\[THINKING_RESULT\]/);
});
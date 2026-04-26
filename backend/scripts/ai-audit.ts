import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BotService } from '../src/bot/bot.service';
import { BotReplyResult } from '../src/bot/bot.types';
import { DEFAULT_COMPANY_CONTEXT } from '../src/company-context/company-context.types';

type AuditSnapshot = {
  timestamp?: number;
  contactId?: string;
  message?: string;
  layer?: string;
  source?: string;
  moduleStats?: {
    ok: boolean;
    missing: string[];
    counts: {
      instruccionesChars: number;
      productosCount: number;
      empresaChars: number;
    };
  };
  replyStats?: {
    ok: boolean;
    severeFailures?: string[];
    criticalFailures?: string[];
    warnings?: string[];
    checks?: {
      usesProducts?: boolean;
      respectsInstructions?: boolean;
      usesCompanyIfApplies?: boolean;
      genericWithoutKnowledge?: boolean;
    };
  };
  forcedBlocked?: boolean;
  context?: {
    knowledgeContextLength?: number;
    combinedContextLength?: number | null;
    warnOver6k?: boolean;
  };
  thinking?: unknown;
};

function createService(options?: {
  mediaCount?: number;
  lastIntent?: string | null;
  aiReply?: string;
  classifiedIntent?: string;
  companyContextText?: string;
  companyContextData?: Record<string, unknown>;
  companyContextResolver?: (message: string) => string;
  configConfigurations?: Record<string, unknown>;
  botConfig?: {
    promptBase?: string;
    promptShort?: string;
    promptHuman?: string;
    promptSales?: string;
  };
  memoryContext?: {
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    clientMemory?: {
      contactId?: string;
      name?: string | null;
      objective?: 'rebajar' | 'info' | 'comprar' | null;
      interest?: string | null;
      objections?: string[];
      status?: 'nuevo' | 'interesado' | 'cliente';
      lastIntent?: string | null;
      notes?: string | null;
      updatedAt?: Date | null;
      expiresAt?: Date | null;
    };
    summary?: {
      contactId?: string;
      summary?: string | null;
      updatedAt?: Date | null;
      expiresAt?: Date | null;
    };
  };
  generateReply?: (params: Record<string, unknown>) => { type: 'text' | 'audio'; content: string } | Promise<{ type: 'text' | 'audio'; content: string }>;
  generateResponses?: (params: Record<string, unknown>) => Array<{ text: string; videoId?: string; imageId?: string; type?: 'text' | 'audio' }> | Promise<Array<{ text: string; videoId?: string; imageId?: string; type?: 'text' | 'audio' }>>;
  classifyIntent?: (params: Record<string, unknown>) => string | Promise<string>;
  onGenerateReply?: (params: Record<string, unknown>) => void;
  onClassifyIntent?: (params: Record<string, unknown>) => void;
  onMediaLookup?: (text: string, take: number) => void;
}) {
  const savedMessagesByContact = new Map<string, Array<{ role: string; content: string }>>();
  const memoryState = {
    lastIntent: options?.lastIntent ?? null,
  };
  const contactStateStore = new Map<string, Record<string, unknown>>();
  const summaryStore = new Map<string, Record<string, unknown>>();

  const redisStore = new Map<string, unknown>();

  const service = new BotService(
    {
      async classifyIntent(params: Record<string, unknown>) {
        options?.onClassifyIntent?.(params);

        if (options?.classifyIntent) {
          return options.classifyIntent(params);
        }

        return options?.classifiedIntent ?? 'curioso';
      },
      async generateReply(params: Record<string, unknown>) {
        options?.onGenerateReply?.(params);

        if (options?.generateReply) {
          return options.generateReply(params);
        }

        return {
          type: 'text' as const,
          content: options?.aiReply ?? 'Claro 👌 te ayudo con eso.',
        };
      },
      async generateResponses(params: Record<string, unknown>) {
        options?.onGenerateReply?.(params);

        if (options?.generateResponses) {
          return options.generateResponses(params);
        }

        if (options?.generateReply) {
          const single = await options.generateReply(params);
          return [{
            text: single.content,
            type: single.type,
          }];
        }

        return [{
          text: options?.aiReply ?? 'Claro 👌 te ayudo con eso.',
          type: 'text' as const,
        }];
      },
    } as any,
    {
      async getConfig() {
        return {
          promptBase: options?.botConfig?.promptBase ?? 'Habla claro y vende con naturalidad.',
          promptShort: options?.botConfig?.promptShort ?? 'Responde con foco comercial.',
          promptHuman: options?.botConfig?.promptHuman ?? 'Tono humano y cercano.',
          promptSales: options?.botConfig?.promptSales ?? 'Cierra suave cuando convenga.',
        };
      },
      getFullPrompt() {
        return '';
      },
    } as any,
    {
      async getContext() {
        return {
          id: 1,
          ...DEFAULT_COMPANY_CONTEXT,
          createdAt: new Date('2026-04-24T00:00:00.000Z'),
          updatedAt: new Date('2026-04-24T00:00:00.000Z'),
          ...(options?.companyContextData ?? {}),
        };
      },
      async buildAgentContext() {
        return options?.companyContextText ?? options?.companyContextResolver?.('') ?? 'EMPRESA:\nNombre: Phyto Emagry\nTelefono: 809-555-1234\nDireccion: Santo Domingo';
      },
      async buildAgentContextForMessage(message: string) {
        return options?.companyContextResolver?.(message) ?? options?.companyContextText ?? '';
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
          configurations: options?.configConfigurations ?? {
            instructions: {
              identity: {
                assistantName: 'Aura',
                role: 'Asesora comercial',
                objective: 'Convertir conversaciones en pedidos',
                tone: 'Cercana',
              },
              rules: ['Siempre responde con datos reales'],
              salesPrompts: {
                opening: 'Abre con cercania.',
                offer: 'Presenta valor y precio.',
              },
              products: [
                {
                  name: 'Te Detox Premium',
                  category: 'Infusion',
                  summary: 'Ayuda a digestion y bienestar.',
                  price: 'RD$1,500',
                },
              ],
            },
          },
        };
      },
    } as any,
    {
      async getMediaByKeyword(_text: string, take = 3) {
        options?.onMediaLookup?.(_text, take);
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
      async saveMessage(entry: { contactId?: string; role: string; content: string }) {
        const contactId = String(entry.contactId ?? 'test-contact');
        const contactMessages = savedMessagesByContact.get(contactId) ?? [];
        contactMessages.push({ role: entry.role, content: entry.content });
        savedMessagesByContact.set(contactId, contactMessages);
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
      async getConversationContext(contactId?: string) {
        const override = options?.memoryContext;
        const storedMessages = savedMessagesByContact.get(String(contactId ?? 'test-contact')) ?? [];
        const clientMemory = {
          contactId: 'test-contact',
          name: 'Maria',
          objective: null,
          interest: 'te detox',
          objections: [],
          status: 'nuevo' as const,
          lastIntent: memoryState.lastIntent,
          notes: null,
          updatedAt: null,
          expiresAt: null,
          ...(override?.clientMemory ?? {}),
        };
        const summary = {
          contactId: 'test-contact',
          summary: null,
          updatedAt: null,
          expiresAt: null,
          ...(override?.summary ?? {}),
        };

        return {
          messages: override?.messages ?? storedMessages.map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content })),
          clientMemory,
          summary,
        };
      },
    } as any,
    {
      store: redisStore,
      async get(key: string) {
        return (this.store as Map<string, unknown>).get(key) ?? null;
      },
      async set(key: string, value: unknown) {
        (this.store as Map<string, unknown>).set(key, value);
      },
      async setIfAbsent(key: string, value: unknown) {
        const store = this.store as Map<string, unknown>;
        if (store.has(key)) {
          return false;
        }
        store.set(key, value);
        return true;
      },
      async del(key: string) {
        (this.store as Map<string, unknown>).delete(key);
      },
    } as any,
    {
      contactState: {
        async findUnique({ where }: { where: { contactId: string } }) {
          return contactStateStore.get(where.contactId) ?? null;
        },
        async upsert({ where, create, update }: { where: { contactId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) {
          const next = {
            ...(contactStateStore.get(where.contactId) ?? {}),
            ...(contactStateStore.has(where.contactId) ? update : create),
          };
          contactStateStore.set(where.contactId, next);
          return next;
        },
        async updateMany({ where, data }: { where: { contactId: string }; data: Record<string, unknown> }) {
          const next = {
            ...(contactStateStore.get(where.contactId) ?? {}),
            ...data,
          };
          contactStateStore.set(where.contactId, next);
          return { count: 1 };
        },
      },
      contactConversationSummary: {
        async upsert({ where, create, update }: { where: { contactId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) {
          const next = {
            ...(summaryStore.get(where.contactId) ?? {}),
            ...(summaryStore.has(where.contactId) ? update : create),
          };
          summaryStore.set(where.contactId, next);
          return next;
        },
      },
    } as any,
  );

  return {
    service,
    redisStore,
  };
}

function getAuditSnapshot(redisStore: Map<string, unknown>, contactId: string): AuditSnapshot | null {
  const raw = redisStore.get(`audit:last:${contactId}`);
  return (raw ?? null) as AuditSnapshot | null;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function assertContains(haystack: string, needle: string): boolean {
  return normalizeText(haystack).includes(normalizeText(needle));
}

async function runScenario(params: {
  name: string;
  contactId: string;
  message: string;
  service: BotService;
  redisStore: Map<string, unknown>;
  expect?: {
    shouldUseProducts?: boolean;
    shouldBeBlocked?: boolean;
    shouldNotUseAi?: boolean;
    mustMentionPrice?: boolean;
    mustMentionBenefits?: boolean;
    mustMentionUsageOrPrice?: boolean;
  };
  capture?: {
    aiCalls?: { count: number };
  };
}): Promise<{
  name: string;
  message: string;
  result: BotReplyResult;
  snapshot: AuditSnapshot | null;
  analysis: unknown;
  nba: unknown;
  checks: Array<{ ok: boolean; label: string; detail?: string }>;
}> {
  const { name, contactId, message, service, redisStore } = params;

  const result = await service.processIncomingMessage(contactId, message);
  const snapshot = getAuditSnapshot(redisStore, contactId);
  const analysis = redisStore.get(`analysis:${contactId}`) ?? null;
  const nba = redisStore.get(`nba:${contactId}`) ?? null;

  const checks: Array<{ ok: boolean; label: string; detail?: string }> = [];

  if (params.expect?.shouldUseProducts) {
    const ok = Boolean(snapshot?.replyStats?.checks?.usesProducts);
    checks.push({ ok, label: 'usesProducts', detail: ok ? undefined : `reply="${result.reply}"` });
  }

  if (params.expect?.shouldBeBlocked) {
    const ok = assertContains(result.reply, 'AUDITORIA') && (snapshot?.layer ?? '').includes('audit_block');
    checks.push({ ok, label: 'blocked_in_strict_mode', detail: ok ? undefined : `layer=${snapshot?.layer ?? 'null'}` });
  }

  if (params.expect?.mustMentionPrice) {
    const ok = /(rd\$|\$|precio)/i.test(result.reply);
    checks.push({ ok, label: 'mentionsPrice', detail: ok ? undefined : `reply="${result.reply}"` });
  }

  if (params.expect?.mustMentionBenefits) {
    const ok = /(beneficio|sirve|ayuda|resultado|bienestar|digestion|digestión)/i.test(result.reply);
    checks.push({ ok, label: 'mentionsBenefits', detail: ok ? undefined : `reply="${result.reply}"` });
  }

  if (params.expect?.mustMentionUsageOrPrice) {
    const ok = /(como se usa|cómo se usa|se usa|toma|dosis|rd\$|precio)/i.test(result.reply);
    checks.push({ ok, label: 'mentionsUsageOrPrice', detail: ok ? undefined : `reply="${result.reply}"` });
  }

  if (params.expect?.shouldNotUseAi && params.capture?.aiCalls) {
    const ok = params.capture.aiCalls.count === 0;
    checks.push({ ok, label: 'noAiCalls', detail: ok ? undefined : `aiCalls=${params.capture.aiCalls.count}` });
  }

  // Context length warning check (requirement #6)
  if (snapshot?.context?.warnOver6k) {
    checks.push({ ok: true, label: 'context>6000_warned', detail: `len=${snapshot.context.combinedContextLength ?? snapshot.context.knowledgeContextLength}` });
  }

  // Thinking logic check (requirement #5)
  const analysisObj = analysis as { nextBestAction?: string; alreadyExplained?: boolean } | null;
  if (analysisObj?.nextBestAction === 'cerrar' && !analysisObj.alreadyExplained) {
    checks.push({ ok: false, label: 'thinking_no_close_without_explain', detail: JSON.stringify(analysisObj) });
  }

  return { name, message, result, snapshot, analysis, nba, checks };
}

function buildReportText(report: {
  ok: boolean;
  startedAt: string;
  scenarios: Array<ReturnType<typeof summarizeScenario>>;
  recommendations: string[];
}): string {
  const lines: string[] = [];
  lines.push('AI AUDIT REPORT');
  lines.push(`startedAt: ${report.startedAt}`);
  lines.push(`ok: ${report.ok}`);
  lines.push('');

  for (const scenario of report.scenarios) {
    lines.push(`- ${scenario.name}: ${scenario.ok ? 'OK' : 'FAIL'}`);
    lines.push(`  message: ${scenario.message}`);
    lines.push(`  reply: ${scenario.reply}`);
    if (scenario.moduleMissing.length > 0) {
      lines.push(`  missingModules: ${scenario.moduleMissing.join(', ')}`);
    }
    if (scenario.failures.length > 0) {
      lines.push(`  failures: ${scenario.failures.join(' | ')}`);
    }
  }

  if (report.recommendations.length > 0) {
    lines.push('');
    lines.push('RECOMMENDATIONS');
    for (const item of report.recommendations) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n');
}

function summarizeScenario(input: {
  name: string;
  message: string;
  result: BotReplyResult;
  snapshot: AuditSnapshot | null;
  checks: Array<{ ok: boolean; label: string; detail?: string }>;
}) {
  const moduleMissing = input.snapshot?.moduleStats?.missing ?? [];
  const replyFailures = [
    ...(input.snapshot?.replyStats?.criticalFailures ?? []),
    ...(input.snapshot?.replyStats?.severeFailures ?? []),
  ];
  const localFailures = input.checks.filter((c) => !c.ok).map((c) => `${c.label}${c.detail ? ` (${c.detail})` : ''}`);
  const failures = [...replyFailures, ...localFailures];
  const ok = failures.length === 0 && moduleMissing.length === 0;
  return {
    name: input.name,
    message: input.message,
    reply: input.result.reply,
    ok,
    moduleMissing,
    failures,
    snapshot: input.snapshot,
  };
}

async function main() {
  // Enable audit mode for the run.
  process.env.BOT_AI_AUDIT = '1';
  process.env.BOT_AI_AUDIT_STRICT = '1';
  delete process.env.BOT_AI_AUDIT_FORCE_BLOCK;

  const startedAt = new Date().toISOString();
  const recommendations: string[] = [];

  // CASE 1: "Ambas cosas"
  let ambasAttempt = 0;
  const { service: service1, redisStore: redis1 } = createService({
    classifyIntent: async () => 'info',
    generateResponses: async () => {
      ambasAttempt += 1;
      if (ambasAttempt === 1) {
        return [{ text: 'Claro 👌 te ayudo con eso.', type: 'text' }];
      }

      return [{
        text: 'Te Detox Premium: ayuda a la digestion y bienestar. Funciona como apoyo diario. Se usa facil: te digo como tomarlo y el precio (RD$1,500). Si lo que buscas es precio, uso o resultados, te guio. ¿Prefieres que te explique como se toma o te paso el precio?'.replace(/\s+/g, ' ').trim(),
        type: 'text',
      }];
    },
  });

  const scenario1 = await runScenario({
    name: 'CASO_1_AMBAS_COSAS',
    contactId: '18095570001',
    message: 'Ambas cosas',
    service: service1,
    redisStore: redis1,
    expect: {
      shouldUseProducts: true,
      mustMentionBenefits: true,
      mustMentionUsageOrPrice: true,
    },
  });

  // CASE 2: "Precio" (should not use AI)
  const aiCalls2 = { count: 0 };
  const { service: service2, redisStore: redis2 } = createService({
    onGenerateReply: () => {
      aiCalls2.count += 1;
    },
  });

  const scenario2 = await runScenario({
    name: 'CASO_2_PRECIO',
    contactId: '18095570002',
    message: 'Precio',
    service: service2,
    redisStore: redis2,
    expect: {
      shouldUseProducts: true,
      shouldNotUseAi: true,
      mustMentionPrice: true,
    },
    capture: {
      aiCalls: aiCalls2,
    },
  });

  // CASE 3: "Como funciona"
  const { service: service3, redisStore: redis3 } = createService({
    classifyIntent: async () => 'info',
    generateResponses: async () => [{
      text: 'Te Detox Premium funciona apoyando la digestion y el bienestar. Si lo que buscas es mejorar la digestion, te puede servir. Te explico como se usa y si quieres te digo el precio (RD$1,500).',
      type: 'text',
    }],
  });

  const scenario3 = await runScenario({
    name: 'CASO_3_COMO_FUNCIONA',
    contactId: '18095570003',
    message: 'Como funciona',
    service: service3,
    redisStore: redis3,
    expect: {
      shouldUseProducts: true,
      mustMentionBenefits: true,
      mustMentionUsageOrPrice: true,
    },
  });

  // CASE 8: Forced block when mandatory modules are missing.
  process.env.BOT_AI_AUDIT = '1';
  process.env.BOT_AI_AUDIT_STRICT = '1';
  const { service: service4, redisStore: redis4 } = createService({
    configConfigurations: {
      instructions: {
        identity: {
          assistantName: 'Aura',
          role: 'Asesora comercial',
          objective: 'Convertir conversaciones en pedidos',
          tone: 'Cercana',
        },
        rules: ['Siempre responde con datos reales'],
        salesPrompts: {
          opening: 'Abre con cercania.',
          offer: 'Presenta valor y precio.',
        },
        products: [],
      },
    },
  });

  const scenario4 = await runScenario({
    name: 'CASO_8_BLOQUEO_SIN_PRODUCTOS',
    contactId: '18095570004',
    message: 'Precio',
    service: service4,
    redisStore: redis4,
    expect: {
      shouldBeBlocked: true,
    },
  });

  const summarized = [scenario1, scenario2, scenario3, scenario4].map((s) => summarizeScenario(s));
  const ok = summarized.every((s) => s.ok);

  // Recommendation for long context
  const anyOver6k = summarized.some((s) => Boolean(s.snapshot?.context?.warnOver6k));
  if (anyOver6k) {
    recommendations.push('Reducir el contexto (priorizar PRODUCTO_RELEVANTE, resumir EMPRESA y reglas) cuando el combinedContextLength supere 6000 chars.');
  }

  const report = {
    ok,
    startedAt,
    objetivo: 'Auditoria completa del sistema de IA (INSTRUCCIONES, PRODUCTOS, EMPRESA).',
    scenarios: summarized,
    recommendations,
  };

  const outJson = resolve(process.cwd(), 'bot-ai-audit-report.json');
  const outTxt = resolve(process.cwd(), 'bot-ai-audit-report.txt');

  writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(outTxt, buildReportText({ ok, startedAt, scenarios: summarized, recommendations }), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`AI audit finished. ok=${ok}`);
  // eslint-disable-next-line no-console
  console.log(`Report written: ${outJson}`);
  // eslint-disable-next-line no-console
  console.log(`Report written: ${outTxt}`);

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('AI audit failed:', error);
  process.exitCode = 1;
});

import { createHash } from 'node:crypto';
import { MediaFile, Prisma } from '@prisma/client';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import {
  AssistantLeadStage,
  AssistantReplyObjective,
  AssistantResponseCandidate,
  AssistantResponseStyle,
} from '../ai/ai.types';
import { BotConfigService } from '../bot-config/bot-config.service';
import { CompanyContextService } from '../company-context/company-context.service';
import { ClientConfigService } from '../config/config.service';
import { MediaService } from '../media/media.service';
import { StoredMessage } from '../memory/memory.types';
import { MemoryService } from '../memory/memory.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  BotDecisionAction,
  BotDecisionIntent,
  BotDecisionState,
  ContactStage,
} from './bot-decision.types';
import {
  BotIntent,
  BotReplyResult,
  BotTestReport,
  BotTestStepResult,
} from './bot.types';
import {
  buildConversationMemoryContext,
  ConversationMemoryState,
  getConversationMemoryKey,
  normalizeConversationMemory,
  recordConversationDelivery,
  ResponseValidationReason,
  validateResponseCandidate,
} from './conversation-memory';
import {
  applyCompanyRules,
  buildCompanyRuleMediaUnavailableResponse,
  buildCompanyRuleInstruction,
  CompanyRuleCheck,
  validateCompanyRuleResponse,
} from './company-rule-engine';
import {
  ComposeOptions,
  composeFinalMessage,
  selectBestResponseWithOptions,
} from './response-composer';

type MediaIntent = 'IMAGEN' | 'VIDEO' | 'MEDIA' | null;

interface StructuredProduct {
  id: string;
  titulo: string;
  descripcionCorta: string;
  descripcionCompleta: string;
  precio: string | number | null;
  precioMinimo: string | number | null;
  imagenes: string[];
  videos: string[];
  activo: boolean;
}

interface SentMediaState {
  sentMediaUrls: string[];
}

interface ThinkingAnalysis {
  intent: string;
  userState: 'frio' | 'curioso' | 'interesado' | 'listo';
  alreadyExplained: boolean;
  repetitionRisk: boolean;
  nextBestAction: 'explicar' | 'resumir' | 'preguntar' | 'cerrar' | 'avanzar';
  responseStrategy: string;
}

interface IntentCacheEntry {
  message: string;
  intent: BotDecisionIntent;
  source: BotDecisionState['classificationSource'];
  updatedAt: number;
}

interface RedisStateSnapshot {
  stage: ContactStage;
  currentIntent: BotDecisionIntent;
  purchaseIntentScore: number;
  updatedAt: number;
}

interface AnalysisCacheEntry {
  intent: string;
  userState: ThinkingAnalysis['userState'];
  alreadyExplained: boolean;
  repetitionRisk: boolean;
  nextBestAction: ThinkingAnalysis['nextBestAction'];
  responseStrategy: string;
  updatedAt: number;
}

interface NextBestActionCacheEntry {
  action: ThinkingAnalysis['nextBestAction'];
  reason: string;
  updatedAt: number;
}

interface ResponseCacheEntry {
  reply: string;
  replyType: BotReplyResult['replyType'];
  intent: BotIntent;
  decisionIntent: BotDecisionIntent;
  stage: ContactStage;
  action: BotDecisionAction;
  purchaseIntentScore: number;
  hotLead: boolean;
  source: BotReplyResult['source'];
  updatedAt: number;
}

interface MediaCacheEntry {
  images: string[];
  videos: string[];
  updatedAt: number;
}

type MicroIntentKind = 'yes' | 'no' | 'soft' | 'thanks' | 'status';

type MicroIntentResolution = {
  reply: string;
  intent: BotIntent;
  decision: BotDecisionState;
};

@Injectable()
export class BotService {
  private static readonly KNOWLEDGE_CONTEXT_CACHE_KEY = 'bot:knowledge-context:v1';
  private static readonly COMPANY_RULES_CACHE_KEY = 'company_rules';
  private static readonly SENT_MEDIA_CACHE_KEY_PREFIX = 'bot:sent-media:';
  private static readonly QUICK_REPLY_CACHE_KEY_PREFIX = 'quick_reply:v1:';
  private static readonly QUICK_REPLY_CACHE_TTL_SECONDS = 60 * 60 * 6;
  private static readonly SPEED_NO_AI_MAX_CHARS = 20;
  private static readonly AI_TIMEOUT_MS = 2000;
  private static readonly AI_CONTEXT_MAX_CHARS = 2000;
  private static readonly GREETING_TTL_SECONDS = 60 * 60 * 24;
  private static readonly GREETING_DAY_KEY_TTL_SECONDS = 60 * 60 * 24 * 4;
  private static readonly CONVERSATION_MEMORY_TTL_SECONDS = 60 * 60 * 24;
  private static readonly CONVERSATION_END_TTL_SECONDS = 60 * 60 * 2;
  private static readonly INTENT_CACHE_TTL_SECONDS = 60 * 60;
  private static readonly STATE_CACHE_TTL_SECONDS = 60 * 60 * 24;
  private static readonly ANALYSIS_CACHE_TTL_SECONDS = 60 * 60 * 24;
  private static readonly NBA_CACHE_TTL_SECONDS = 60 * 60 * 24;
  private static readonly MEDIA_CACHE_TTL_SECONDS = 60 * 60 * 6;
  private static readonly RESPONSE_CACHE_TTL_SECONDS = 60 * 10;
  private static readonly MICRO_CONTEXT_TTL_SECONDS = 60 * 60 * 24;
  private static readonly MAX_REPLY_REGENERATION_ATTEMPTS = 2;
  private static readonly MEDIA_COOLDOWN_MS = 10 * 60 * 1000;
  private static readonly SHORT_TEXT_MESSAGE_MAX_CHARS = 40;
  private static readonly LONG_AUDIO_TRANSCRIPT_MIN_CHARS = 80;
  private static readonly LONG_REPLY_MIN_CHARS = 160;
  private static readonly DEFAULT_AI_CONTEXT = [
    'Eres un asistente de ventas por WhatsApp.',
    'Responde de forma natural, clara y humana.',
    'Tu objetivo es ayudar y vender.',
  ].join('\n');

  private readonly logger = new Logger(BotService.name);

  private readonly productMediaTimestamp = new Date('2026-04-24T00:00:00.000Z');

  private static readonly KNOWLEDGE_ENFORCEMENT_MAX_RELOAD_ATTEMPTS = 1;

  constructor(
    private readonly aiService: AiService,
    private readonly botConfigService: BotConfigService,
    private readonly companyContextService: CompanyContextService,
    private readonly clientConfigService: ClientConfigService,
    private readonly mediaService: MediaService,
    private readonly memoryService: MemoryService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async processIncomingMessage(
    contactId: string,
    message: string,
    metadata?: {
      messageType?: 'text' | 'audio' | 'image';
      transcript?: string | null;
    },
  ): Promise<BotReplyResult> {
    const normalizedContactId = contactId.trim();
    const normalizedMessage = message.trim();
    let userMessageStored = false;

    if (!normalizedContactId) {
      throw new BadRequestException('contactId is required');
    }

    if (!/^\+?[0-9A-Za-z._:-]{3,120}$/.test(normalizedContactId)) {
      throw new BadRequestException('contactId is invalid');
    }

    if (!normalizedMessage) {
      throw new BadRequestException('message is required');
    }

    this.logger.log(
      JSON.stringify({
        event: 'bot_message_received',
        contactId: normalizedContactId,
        message: normalizedMessage,
      }),
    );
    console.log('NUMERO:', normalizedContactId);
    console.log('MENSAJE:', normalizedMessage);

    try {
      // RESPONSE LOCK (CRÍTICO): ensures exactly one layer produces the final response.
      let responseGenerated = false;
      let finalResult: BotReplyResult | null = null;
      let finalResponse = '';

      const logResponseDebug = (payload: {
        layer: string;
        blocked: boolean;
        duplicateRemoved?: boolean;
        reason?: string;
        source?: string;
      }) => {
        this.logger.log(
          JSON.stringify({
            event: 'RESPONSE_DEBUG',
            contactId: normalizedContactId,
            message: normalizedMessage,
            layer: payload.layer,
            blocked: payload.blocked,
            duplicateRemoved: payload.duplicateRemoved ?? false,
            reason: payload.reason ?? null,
            source: payload.source ?? null,
          }),
        );
      };

      const finalizeResponse = (layer: string, result: BotReplyResult): BotReplyResult => {
        if (responseGenerated && finalResult) {
          logResponseDebug({ layer, blocked: true, reason: 'response_already_generated', source: result.source });
          if (process.env.BOT_DEBUG_HOTLEAD === '1') {
            console.log('FINALIZE_RESPONSE_RETURNING_EXISTING', {
              layer,
              source: finalResult.source,
              hotLead: finalResult.hotLead,
              usedGallery: finalResult.usedGallery,
            });
          }
          return finalResult;
        }

        // RESPONSE COMPOSER hardening for ALL layers: remove duplicated sentences/lead phrases.
        const original = (result.reply ?? '').trim();
        // IMPORTANT: do NOT aggressively truncate AI replies here.
        // AI replies are already composed upstream with dynamic options (detailed vs brief).
        // We only want dedupe/lead hardening + max 1 question across layers.
        const composed = composeFinalMessage(original, { maxIdeas: 6, maxQuestions: 1 }) || original;

        const duplicateRemoved = composed.trim() !== original;
        const patchedResult = duplicateRemoved ? { ...result, reply: composed.trim() } : result;

        responseGenerated = true;
        finalResult = patchedResult;
        finalResponse = patchedResult.reply;

        if (process.env.BOT_DEBUG_HOTLEAD === '1') {
          console.log('FINALIZE_RESPONSE_SET', {
            layer,
            source: patchedResult.source,
            hotLead: patchedResult.hotLead,
            usedGallery: patchedResult.usedGallery,
          });
        }

        logResponseDebug({ layer, blocked: false, duplicateRemoved, source: patchedResult.source });
        return patchedResult;
      };

      // CRITICAL: Always load/read mandatory knowledge modules BEFORE generating any response.
      // Even for early-exit layers (greetings, micro-intents, closures), we preload the modules
      // so the bot has a consistent, app-config-aligned view of INSTRUCCIONES/PRODUCTOS/EMPRESA.
      let config = await this.clientConfigService.getConfig();
      let botConfig = await this.botConfigService.getConfig();
      let instructionsTextForAudit = this.buildInstructionsKnowledgeBlock(config, botConfig);
      const memoryWindow = config.aiSettings?.memoryWindow ?? 6;
      let allProducts = this.getProductsFromConfig(config);
      let relevantProductsRaw = this.filterRelevantProducts(allProducts, normalizedMessage);
      let relevantProducts = this.applySingleActiveProductAssumption(allProducts, relevantProductsRaw);
      console.log('PRODUCTOS:', allProducts);
      console.log('PRODUCTOS_RELEVANTES:', relevantProducts);

      let relevantProduct = relevantProducts[0] ?? null;
      let preloadedKnowledgeContext = await this.getRequiredKnowledgeContext(
        config,
        botConfig,
        normalizedMessage,
        relevantProducts,
      );

      let companyDataTextForAudit = this.extractBracketSection(preloadedKnowledgeContext, 'EMPRESA');
      let moduleStatsForAudit = this.buildAiAuditModuleStats({
        message: normalizedMessage,
        knowledgeContext: preloadedKnowledgeContext,
        instructionsText: instructionsTextForAudit,
        allProducts,
        companyDataText: companyDataTextForAudit,
      });

      // KNOWLEDGE ENFORCEMENT: if modules look missing, attempt a single reload.
      // This matches the "releer" requirement (try to re-fetch config + rebuild context) before blocking.
      if (this.isKnowledgeEnforcementEnabled() && !moduleStatsForAudit.ok) {
        for (let attempt = 0; attempt < BotService.KNOWLEDGE_ENFORCEMENT_MAX_RELOAD_ATTEMPTS; attempt += 1) {
          try {
            await this.redisService.del(BotService.KNOWLEDGE_CONTEXT_CACHE_KEY);
          } catch {
            // Ignore reload failures.
          }

          config = await this.clientConfigService.getConfig();
          botConfig = await this.botConfigService.getConfig();
          instructionsTextForAudit = this.buildInstructionsKnowledgeBlock(config, botConfig);
          allProducts = this.getProductsFromConfig(config);
          relevantProductsRaw = this.filterRelevantProducts(allProducts, normalizedMessage);
          relevantProducts = this.applySingleActiveProductAssumption(allProducts, relevantProductsRaw);
          relevantProduct = relevantProducts[0] ?? null;
          preloadedKnowledgeContext = await this.getRequiredKnowledgeContext(
            config,
            botConfig,
            normalizedMessage,
            relevantProducts,
          );
          companyDataTextForAudit = this.extractBracketSection(preloadedKnowledgeContext, 'EMPRESA');
          moduleStatsForAudit = this.buildAiAuditModuleStats({
            message: normalizedMessage,
            knowledgeContext: preloadedKnowledgeContext,
            instructionsText: instructionsTextForAudit,
            allProducts,
            companyDataText: companyDataTextForAudit,
          });

          this.logger.log(
            JSON.stringify({
              event: 'KNOWLEDGE_ENFORCEMENT',
              contactId: normalizedContactId,
              message: normalizedMessage,
              kind: 'reload_attempt',
              attempt: attempt + 1,
              ok: moduleStatsForAudit.ok,
              missing: moduleStatsForAudit.missing,
            }),
          );

          if (moduleStatsForAudit.ok) {
            break;
          }
        }
      }

      if (this.isAiAuditEnabled()) {
        this.auditLog({
          contactId: normalizedContactId,
          message: normalizedMessage,
          kind: 'module_load',
          ok: moduleStatsForAudit.ok,
          missing: moduleStatsForAudit.missing,
          counts: moduleStatsForAudit.counts,
          sections: moduleStatsForAudit.sections,
        });
      }

      const mustBlockForMissingKnowledge = !moduleStatsForAudit.ok
        && (this.isKnowledgeEnforcementEnabled() || (this.isAiAuditEnabled() && this.isAiAuditStrict()));

      if (mustBlockForMissingKnowledge) {
        const prefix = this.isAiAuditEnabled() ? 'AUDITORIA: ' : '';
        const reply = `${prefix}ERROR CRITICO. Faltan modulos: ${moduleStatsForAudit.missing.join(', ')}. No puedo responder con datos reales hasta que esten configurados.`;
        const decision = this.buildQuickDecisionState({
          contactId: normalizedContactId,
          message: normalizedMessage,
          decisionIntent: 'info',
          stage: 'curioso',
          action: 'guiar',
          summary: 'Blocked due to missing mandatory knowledge modules.',
        });
        const blocked = this.createResult(
          reply,
          'fallback',
          'otro',
          decision,
          false,
          [],
          'text',
          false,
        );
        await this.persistAuditSnapshot(normalizedContactId, {
          timestamp: Date.now(),
          contactId: normalizedContactId,
          message: normalizedMessage,
          layer: 'audit_block_missing_modules',
          moduleStats: moduleStatsForAudit,
          replyStats: {
            ok: false,
            severeFailures: ['FALLA_CRITICA: modulos_no_cargados'],
            criticalFailures: moduleStatsForAudit.missing.map((value) => `MODULO_FALTANTE:${value}`),
          },
          reply,
          source: blocked.source,
        });

        return blocked;
      }

      const finalizeResponseAudited = async (
        layer: string,
        result: BotReplyResult,
        meta?: {
          thinkingAnalysis?: unknown;
          combinedContextLength?: number;
          knowledgeContextLength?: number;
        },
      ): Promise<BotReplyResult> => {
        let adjustedResult = result;

        // Compose first so enforcement validates what will actually be sent.
        const composedForValidation = composeFinalMessage(adjustedResult.reply ?? '', { maxIdeas: 6, maxQuestions: 1 })
          || (adjustedResult.reply ?? '').trim();
        if (composedForValidation && composedForValidation !== adjustedResult.reply) {
          adjustedResult = {
            ...adjustedResult,
            reply: composedForValidation,
            cached: false,
          };
        }

        let replyStats = this.buildAiAuditReplyStats({
          message: normalizedMessage,
          reply: adjustedResult.reply,
          mediaCount: adjustedResult.mediaFiles.length,
          allProducts,
          relevantProducts,
          companyDataText: companyDataTextForAudit,
          instructionsText: instructionsTextForAudit,
        });

        // CORRECCION AUTOMATICA (sin IA): si falla cualquier check, intentamos regenerar el texto
        // re-usando PRODUCTOS/EMPRESA (snippet) para cumplir minimo de valor y coherencia.
        if (this.isKnowledgeEnforcementEnabled() && !replyStats.ok) {
          const featuredProductForFix = relevantProduct ?? relevantProducts[0] ?? allProducts[0] ?? null;
          const valueSnippet = this.buildProductValueMiniSnippet({
            product: featuredProductForFix,
            message: normalizedMessage,
          });

          const genericWithoutKnowledgeFix = allProducts.length === 0
            && replyStats.criticalFailures.includes('RESPUESTA_SIN_BASE_DE_CONOCIMIENTO');
          const catalogNotConfiguredReply = genericWithoutKnowledgeFix
            ? 'Ahora mismo no tengo el catálogo configurado, pero te puedo orientar. ¿Qué te interesa saber primero: beneficios, cómo se usa o cómo hacer el pedido?'
            : '';

          const companyName = this.parseCompanyNameFromCompanyDataText(companyDataTextForAudit);
          const companyApplicable = this.detectCompanyApplicability(normalizedMessage);
          const needsCompany = companyApplicable !== null && companyName.trim().length > 0;
          const hasCompanyAlready = companyName.trim()
            ? adjustedResult.reply.toLowerCase().includes(companyName.trim().toLowerCase())
            : true;

          const patchedReply = genericWithoutKnowledgeFix
            ? catalogNotConfiguredReply
            : [
                needsCompany && !hasCompanyAlready ? `Soy de ${companyName.trim()}.` : '',
                adjustedResult.reply,
                valueSnippet && allProducts.length > 0 && (
                  !replyStats.checks.usesProducts
                  || !replyStats.checks.hasBenefit
                  || !replyStats.checks.hasFunction
                  || !replyStats.checks.hasNeedConnection
                  || !this.replyMentionsAnyProduct(adjustedResult.reply, relevantProducts.length > 0 ? relevantProducts : allProducts)
                )
                  ? valueSnippet
                  : '',
              ]
                .filter((value) => String(value || '').trim().length > 0)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();

          const patchedComposed = composeFinalMessage(patchedReply, { maxIdeas: 6, maxQuestions: 1 }) || patchedReply;

          const patchedStats = this.buildAiAuditReplyStats({
            message: normalizedMessage,
            reply: patchedComposed,
            mediaCount: adjustedResult.mediaFiles.length,
            allProducts,
            relevantProducts,
            companyDataText: companyDataTextForAudit,
            instructionsText: instructionsTextForAudit,
          });

          if (patchedStats.ok) {
            this.logger.log(
              JSON.stringify({
                event: 'KNOWLEDGE_ENFORCEMENT',
                contactId: normalizedContactId,
                message: normalizedMessage,
                kind: 'auto_correction_applied',
                layer,
                failuresBefore: [...replyStats.criticalFailures, ...replyStats.severeFailures],
              }),
            );

            adjustedResult = {
              ...adjustedResult,
              reply: patchedComposed,
              cached: false,
            };
            replyStats = patchedStats;
          }
        }

        // Enforce: block generic / non-knowledge answers, even when audit is disabled.
        // AI path regenerates upstream; hardcoded paths are expected to comply via builders.
        const mustHardBlock = this.isKnowledgeEnforcementEnabled() && !replyStats.ok;
        const enforcementBlock = mustHardBlock
          ? {
              ...adjustedResult,
              reply: 'ERROR: Respuesta bloqueada por falta de base de conocimiento (PRODUCTOS/INSTRUCCIONES/EMPRESA) o por no cumplir el minimo de valor (beneficio + funcion + conexion).',
              source: 'fallback' as const,
              cached: false,
              usedGallery: false,
              mediaFiles: [],
            }
          : adjustedResult;

        const mustForceBlock = this.isAiAuditEnabled() && this.isAiAuditForceBlock();
        const forceBlock = mustForceBlock && !replyStats.checks.usesProducts;
        let adjusted = forceBlock
          ? {
              ...enforcementBlock,
              reply: 'AUDITORIA: RESPUESTA BLOQUEADA. La respuesta no uso PRODUCTOS/INSTRUCCIONES de forma verificable. Ajusta el flujo para basarse en conocimiento antes de responder.',
              source: 'fallback' as const,
              cached: false,
              usedGallery: false,
              mediaFiles: [],
            }
          : enforcementBlock;

        // If we changed the outgoing text during composition/enforcement, recompute the reply modality.
        // This keeps audio selection aligned with the *final* text that will be spoken/sent.
        if ((adjusted.mediaFiles?.length ?? 0) === 0) {
          adjusted = {
            ...adjusted,
            replyType: this.resolvePreferredReplyType({
              message: normalizedMessage,
              reply: adjusted.reply,
              intent: adjusted.intent,
              action: adjusted.action,
              metadata,
            }),
          };
        }

        const finalized = finalizeResponse(layer, adjusted);

        const knowledgeContextLength = meta?.knowledgeContextLength ?? preloadedKnowledgeContext.length;
        const combinedContextLength = meta?.combinedContextLength ?? null;
        const warnOver6k = (combinedContextLength ?? knowledgeContextLength) > 6000;
        if (this.isAiAuditEnabled() && warnOver6k) {
          this.auditLog({
            contactId: normalizedContactId,
            message: normalizedMessage,
            kind: 'context_length_warning',
            knowledgeContextLength,
            combinedContextLength,
            warning: 'ADVERTENCIA: POSIBLE CONFUSION DE IA (contexto > 6000 caracteres)',
          });
        }

        if (this.isAiAuditEnabled()) {
          this.auditLog({
            contactId: normalizedContactId,
            message: normalizedMessage,
            kind: 'reply_validation',
            layer,
            source: finalized.source,
            checks: replyStats.checks,
            severeFailures: replyStats.severeFailures,
            criticalFailures: replyStats.criticalFailures,
            warnings: replyStats.warnings,
            forcedBlocked: forceBlock,
          });
        }

        if (this.isAiAuditEnabled() && meta?.thinkingAnalysis) {
          const thinking = meta.thinkingAnalysis as {
            nextBestAction?: string;
            alreadyExplained?: boolean;
          };
          if (thinking.nextBestAction === 'cerrar' && !thinking.alreadyExplained) {
            this.auditLog({
              contactId: normalizedContactId,
              message: normalizedMessage,
              kind: 'thinking_logic',
              ok: false,
              error: 'ERROR_DE_LOGICA: nextBestAction=cerrar sin explicacion previa',
              thinking: meta.thinkingAnalysis,
            });
          } else {
            this.auditLog({
              contactId: normalizedContactId,
              message: normalizedMessage,
              kind: 'thinking_logic',
              ok: true,
              thinking: meta.thinkingAnalysis,
            });
          }
        }

        await this.persistAuditSnapshot(normalizedContactId, {
          timestamp: Date.now(),
          contactId: normalizedContactId,
          message: normalizedMessage,
          layer,
          source: finalized.source,
          intent: finalized.intent,
          decisionIntent: finalized.decisionIntent,
          replyType: finalized.replyType,
          moduleStats: moduleStatsForAudit,
          replyStats,
          forcedBlocked: forceBlock,
          context: {
            knowledgeContextLength,
            combinedContextLength,
            warnOver6k,
          },
          thinking: meta?.thinkingAnalysis ?? null,
        });

        return finalized;
      };

      const earlyClosureDetected = this.shouldMarkConversationAsEnded(normalizedMessage);
      if (earlyClosureDetected) {
        if (responseGenerated && finalResult) {
          logResponseDebug({ layer: 'stop_early', blocked: true, reason: 'response_already_generated' });
          return finalResult;
        }

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'user',
          content: normalizedMessage,
        });
        userMessageStored = true;
        await this.rememberLastMessageType(normalizedContactId, metadata?.messageType ?? 'text');

        const conversationEndKey = this.getConversationEndKey(normalizedContactId);
        await this.redisService.set(
          conversationEndKey,
          true,
          BotService.CONVERSATION_END_TTL_SECONDS,
        );

        const conversationMemory = await this.getConversationMemory(normalizedContactId, []);
        const closureDecision = this.buildConversationEndedDecision(normalizedMessage);
        const closureReply = this.buildConversationEndedReply(
          conversationMemory,
          true,
          this.buildProductValueMiniSnippet({
            product: relevantProduct ?? allProducts[0] ?? null,
            message: normalizedMessage,
          }),
        );

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: closureReply,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: closureReply,
            lastMessages: [normalizedMessage, closureReply],
            lastIntent: closureDecision.intent,
            state: closureDecision.stage,
            lastSentHadVideo: false,
            cooldownMediaUntil: null,
          }),
        );

        const usedMemory = conversationMemory.lastMessages.length > 0;
        const closureResult = this.createResult(
          closureReply,
          'cierre',
          'cierre',
          closureDecision,
          false,
          [],
          'text',
          usedMemory,
        );

        await this.markBotResponseInDecisionState(
          normalizedContactId,
          closureResult.reply,
          closureDecision,
          [],
        );
        await this.persistMicroContext(
          normalizedContactId,
          closureDecision.intent,
          closureResult.reply,
          metadata?.messageType ?? 'text',
        );
        this.logReply(normalizedContactId, closureResult);
        return await finalizeResponseAudited('stop_early', closureResult);
      }

      const isPureGreeting = this.isGreetingOnlyMessage(normalizedMessage);
      let hasPriorContextForGreeting = false;
      if (isPureGreeting) {
        const preGreetingContext = await this.memoryService.getConversationContext(
          normalizedContactId,
          2,
        );

        const status = (preGreetingContext as { clientMemory?: { status?: string | null } })
          ?.clientMemory?.status ?? 'nuevo';
        const messageCount = (preGreetingContext as { messages?: unknown[] })?.messages?.length ?? 0;
        const summaryText = (preGreetingContext as { summary?: { summary?: string | null } })
          ?.summary?.summary ?? null;

        hasPriorContextForGreeting =
          messageCount > 0 ||
          Boolean(summaryText?.trim()) ||
          (typeof status === 'string' && status.trim().length > 0 && status !== 'nuevo');
      }

      if (this.isSpeedGreetingMessage(normalizedMessage) && !hasPriorContextForGreeting) {
        if (responseGenerated && finalResult) {
          logResponseDebug({ layer: 'hardcode_greeting', blocked: true, reason: 'response_already_generated' });
          return finalResult;
        }

        const closedResult = await this.handleClosedConversationForSpeedPath({
          contactId: normalizedContactId,
          message: normalizedMessage,
          messageType: metadata?.messageType ?? 'text',
          featuredProduct: relevantProduct ?? allProducts[0] ?? null,
        });
        if (closedResult) {
          return await finalizeResponseAudited('stop', closedResult);
        }

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'user',
          content: normalizedMessage,
        });
        userMessageStored = true;
        await this.rememberLastMessageType(normalizedContactId, metadata?.messageType ?? 'text');

        const conversationMemory = await this.getConversationMemory(normalizedContactId, []);
        const companyDataText = this.extractBracketSection(preloadedKnowledgeContext, 'EMPRESA');
        const companyName = this.parseCompanyNameFromCompanyDataText(companyDataText);
        const featuredProduct = relevantProduct ?? allProducts[0] ?? null;
        const productSnippet = this.buildProductValueMiniSnippet({
          product: featuredProduct,
          message: normalizedMessage,
        });
        const reply = this.buildSpeedGreetingReplyWithContext({
          companyName,
          productSnippet,
        });
        await this.redisService.set(
          this.getQuickReplyCacheKey('greeting', null),
          reply,
          BotService.QUICK_REPLY_CACHE_TTL_SECONDS,
        );
        const decision = this.buildQuickDecisionState({
          contactId: normalizedContactId,
          message: normalizedMessage,
          decisionIntent: 'otro',
          stage: 'curioso',
          action: 'guiar',
          summary: 'Saludo rapido (sin IA).',
        });

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: reply,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: reply,
            lastMessages: [normalizedMessage, reply],
            lastIntent: decision.intent,
            state: decision.stage,
            lastSentHadVideo: false,
            cooldownMediaUntil: null,
          }),
        );

        const result = this.createResult(
          reply,
          'hardcode',
          'otro',
          decision,
          false,
          [],
          'text',
          conversationMemory.lastMessages.length > 0,
        );
        await this.markBotResponseInDecisionState(normalizedContactId, result.reply, decision, []);
        await this.persistMicroContext(
          normalizedContactId,
          decision.intent,
          result.reply,
          metadata?.messageType ?? 'text',
        );
        this.logReply(normalizedContactId, result);
        return await finalizeResponseAudited('hardcode_greeting', result);
      }

      const greetingOutcome = await this.getGreetingOutcome(normalizedContactId, normalizedMessage);
      if (greetingOutcome === 'first' && isPureGreeting && !hasPriorContextForGreeting) {
        if (responseGenerated && finalResult) {
          logResponseDebug({ layer: 'greeting', blocked: true, reason: 'response_already_generated' });
          return finalResult;
        }

        console.log('GREETING ACTIVADO:', normalizedContactId, greetingOutcome);

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'user',
          content: normalizedMessage,
        });
        userMessageStored = true;

        const conversationMemory = await this.getConversationMemory(normalizedContactId, []);
        const companyDataText = this.extractBracketSection(preloadedKnowledgeContext, 'EMPRESA');
        const companyName = this.parseCompanyNameFromCompanyDataText(companyDataText);
        const featuredProduct = relevantProduct ?? allProducts[0] ?? null;
        const productSnippet = this.buildProductValueMiniSnippet({
          product: featuredProduct,
          message: normalizedMessage,
        });
        const greetingReply = this.buildGreetingReply(normalizedContactId, conversationMemory, {
          companyName,
          productSnippet,
        });
        const greetingDecision = this.buildGreetingDecision(normalizedMessage);

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: greetingReply,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: greetingReply,
            lastMessages: [normalizedMessage, greetingReply],
            lastIntent: greetingDecision.intent,
            state: greetingDecision.stage,
            lastSentHadVideo: false,
            cooldownMediaUntil: null,
          }),
        );

        const greetingResult = this.createResult(
          greetingReply,
          'greeting',
          'otro',
          greetingDecision,
          false,
          [],
          'text',
          conversationMemory.lastMessages.length > 0,
        );

        await this.markBotResponseInDecisionState(
          normalizedContactId,
          greetingResult.reply,
          greetingDecision,
          [],
        );
        await this.persistMicroContext(
          normalizedContactId,
          greetingDecision.intent,
          greetingResult.reply,
          metadata?.messageType ?? 'text',
        );
        this.logReply(normalizedContactId, greetingResult);
        return await finalizeResponseAudited('greeting', greetingResult);
      }

      let quickInfoKindForCache: 'benefits' | 'usage' | null = null;
      const speedKind = this.detectSpeedKind(normalizedMessage);
      if (speedKind === 'price') {
        if (responseGenerated && finalResult) {
          logResponseDebug({ layer: 'hardcode_price', blocked: true, reason: 'response_already_generated' });
          return finalResult;
        }

        const closedResult = await this.handleClosedConversationForSpeedPath({
          contactId: normalizedContactId,
          message: normalizedMessage,
          messageType: metadata?.messageType ?? 'text',
          featuredProduct: relevantProduct ?? allProducts[0] ?? null,
        });
        if (closedResult) {
          return await finalizeResponseAudited('stop', closedResult);
        }

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'user',
          content: normalizedMessage,
        });
        userMessageStored = true;
        await this.rememberLastMessageType(normalizedContactId, metadata?.messageType ?? 'text');

        const conversationMemory = await this.getConversationMemory(normalizedContactId, []);
        const reply = this.buildQuickPriceReply(allProducts, relevantProducts, normalizedMessage);
        await this.redisService.set(
          this.getQuickReplyCacheKey('price', relevantProduct?.id ?? null),
          reply,
          BotService.QUICK_REPLY_CACHE_TTL_SECONDS,
        );

        const decision = this.buildQuickDecisionState({
          contactId: normalizedContactId,
          message: normalizedMessage,
          decisionIntent: 'precio',
          stage: 'curioso',
          action: 'responder_precio_con_valor',
          summary: 'Precio rapido (sin IA).',
        });
        const intent = this.mapDecisionIntentToBotIntent(decision.intent, normalizedMessage);

        const sentMediaState = await this.getSentMediaState(normalizedContactId);
        const mediaIntent = this.detectMediaIntent(normalizedMessage);
        const productMediaCandidates = relevantProducts.length > 0 ? relevantProducts : allProducts;
        const productMediaFiles = await this.selectProductMedia(
          productMediaCandidates,
          mediaIntent,
          decision.action,
        );
        const candidateMediaFiles = this.filterConversationMediaFiles(
          this.limitOutgoingMediaFiles(productMediaFiles, mediaIntent, sentMediaState),
          conversationMemory,
        );

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: reply,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: reply,
            mediaIds: candidateMediaFiles.map((file) => file.fileUrl),
            lastMessages: [normalizedMessage, reply],
            lastIntent: decision.intent,
            state: decision.stage,
            lastSentHadVideo: candidateMediaFiles.some((file) => file.fileType === 'video'),
            cooldownMediaUntil:
              candidateMediaFiles.length > 0
                ? Date.now() + BotService.MEDIA_COOLDOWN_MS
                : null,
          }),
        );

        const result = this.createResult(
          reply,
          'hardcode',
          intent,
          decision,
          false,
          candidateMediaFiles,
          'text',
          conversationMemory.lastMessages.length > 0,
        );
        await this.markBotResponseInDecisionState(
          normalizedContactId,
          result.reply,
          decision,
          candidateMediaFiles,
        );
        await this.persistMicroContext(
          normalizedContactId,
          decision.intent,
          result.reply,
          metadata?.messageType ?? 'text',
        );
        this.logReply(normalizedContactId, result);
        return await finalizeResponseAudited('hardcode_price', result);
      }

      if (speedKind === 'hours' || speedKind === 'location' || speedKind === 'payment') {
        if (responseGenerated && finalResult) {
          logResponseDebug({ layer: 'hardcode_company_info', blocked: true, reason: 'response_already_generated' });
          return finalResult;
        }

        const closedResult = await this.handleClosedConversationForSpeedPath({
          contactId: normalizedContactId,
          message: normalizedMessage,
          messageType: metadata?.messageType ?? 'text',
          featuredProduct: relevantProduct ?? allProducts[0] ?? null,
        });
        if (closedResult) {
          return await finalizeResponseAudited('stop', closedResult);
        }

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'user',
          content: normalizedMessage,
        });
        userMessageStored = true;
        await this.rememberLastMessageType(normalizedContactId, metadata?.messageType ?? 'text');

        const conversationMemory = await this.getConversationMemory(normalizedContactId, []);
        const companyData = await this.getCachedCompanyRules();
        const companyCheck = applyCompanyRules(
          normalizedMessage,
          {
            intent: 'otro',
            userState: 'curioso',
            alreadyExplained: false,
            repetitionRisk: false,
            nextBestAction: 'preguntar',
            responseStrategy: 'speed_company_info',
          },
          companyData,
          new Date(Date.now()),
        );

        const companyName = this.parseCompanyNameFromCompanyDataText(companyDataTextForAudit);
        const companyIdentity = companyName ? `Soy de ${companyName}.` : '';
        const baseReplyRaw = companyCheck.overrideResponse
          ? companyCheck.overrideResponse
          : speedKind === 'hours'
            ? 'Claro. En este momento no tengo el horario configurado. ¿Me confirmas tu ciudad?'
            : speedKind === 'location'
              ? 'Claro. En este momento no tengo la ubicacion configurada. ¿Me confirmas tu ciudad?'
              : 'Claro. En este momento no tengo los metodos de pago configurados. ¿Prefieres transferencia o efectivo?';
        const baseReply = companyIdentity && !companyCheck.overrideResponse
          ? `${companyIdentity} ${baseReplyRaw}`.replace(/\s+/g, ' ').trim()
          : baseReplyRaw;

        const featuredProduct = relevantProduct ?? allProducts[0] ?? null;
        const valueSnippet = this.buildProductValueMiniSnippet({
          product: featuredProduct,
          message: normalizedMessage,
        });
        const reply = valueSnippet && allProducts.length > 0 && !this.replyMentionsAnyProduct(baseReply, relevantProducts.length > 0 ? relevantProducts : allProducts)
          ? `${baseReply} ${valueSnippet}`
          : baseReply;

        const decision = this.buildQuickDecisionState({
          contactId: normalizedContactId,
          message: normalizedMessage,
          decisionIntent: 'info',
          stage: 'curioso',
          action: 'guiar',
          summary: 'Empresa info rapida (sin IA).',
        });
        const intent = this.mapDecisionIntentToBotIntent(decision.intent, normalizedMessage);

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: reply,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: reply,
            lastMessages: [normalizedMessage, reply],
            lastIntent: decision.intent,
            state: decision.stage,
            lastSentHadVideo: false,
            cooldownMediaUntil: null,
          }),
        );

        const result = this.createResult(
          reply,
          'hardcode',
          intent,
          decision,
          false,
          [],
          'text',
          conversationMemory.lastMessages.length > 0,
        );
        await this.markBotResponseInDecisionState(normalizedContactId, result.reply, decision, []);
        await this.persistMicroContext(
          normalizedContactId,
          decision.intent,
          result.reply,
          metadata?.messageType ?? 'text',
        );
        this.logReply(normalizedContactId, result);
        return await finalizeResponseAudited('hardcode_company_info', result);
      }

      const quickInfoKind = this.detectQuickInfoKind(normalizedMessage);
      if (quickInfoKind) {
        const closedResult = await this.handleClosedConversationForSpeedPath({
          contactId: normalizedContactId,
          message: normalizedMessage,
          messageType: metadata?.messageType ?? 'text',
          featuredProduct: relevantProduct ?? allProducts[0] ?? null,
        });
        if (closedResult) {
          return await finalizeResponseAudited('stop', closedResult);
        }

        const cacheKey = this.getQuickReplyCacheKey(quickInfoKind, relevantProduct?.id ?? null);
        let cachedQuickReply = await this.readRedisCache<string>(cacheKey);
        if (cachedQuickReply?.trim() && this.isKnowledgeEnforcementEnabled()) {
          const cacheStats = this.buildAiAuditReplyStats({
            message: normalizedMessage,
            reply: cachedQuickReply.trim(),
            mediaCount: 0,
            allProducts,
            relevantProducts,
            companyDataText: companyDataTextForAudit,
            instructionsText: instructionsTextForAudit,
          });
          if (!cacheStats.ok) {
            this.logger.log(
              JSON.stringify({
                event: 'KNOWLEDGE_ENFORCEMENT',
                contactId: normalizedContactId,
                message: normalizedMessage,
                kind: 'discard_quick_cache',
                cacheKey,
                failures: [...cacheStats.criticalFailures, ...cacheStats.severeFailures],
              }),
            );
            cachedQuickReply = null;
            try {
              await this.redisService.del(cacheKey);
            } catch {
              // Ignore cache cleanup failures.
            }
          }
        }
        if (cachedQuickReply?.trim()) {
          if (responseGenerated && finalResult) {
            logResponseDebug({ layer: 'quick_cache', blocked: true, reason: 'response_already_generated' });
            return finalResult;
          }

          await this.memoryService.saveMessage({
            contactId: normalizedContactId,
            role: 'user',
            content: normalizedMessage,
          });
          userMessageStored = true;
          await this.rememberLastMessageType(normalizedContactId, metadata?.messageType ?? 'text');

          const conversationMemory = await this.getConversationMemory(normalizedContactId, []);
          const decision = this.buildQuickDecisionState({
            contactId: normalizedContactId,
            message: normalizedMessage,
            decisionIntent: 'info',
            stage: 'curioso',
            action: 'guiar',
            summary: 'Respuesta rapida (cache) sin IA.',
          });
          const intent = this.mapDecisionIntentToBotIntent(decision.intent, normalizedMessage);

          await this.memoryService.saveMessage({
            contactId: normalizedContactId,
            role: 'assistant',
            content: cachedQuickReply.trim(),
          });
          await this.saveConversationMemory(
            recordConversationDelivery(conversationMemory, {
              messageText: cachedQuickReply.trim(),
              lastMessages: [normalizedMessage, cachedQuickReply.trim()],
              lastIntent: decision.intent,
              state: decision.stage,
              lastSentHadVideo: false,
              cooldownMediaUntil: null,
            }),
          );

          const result = this.createResult(
            cachedQuickReply.trim(),
            'cache',
            intent,
            decision,
            false,
            [],
            'text',
            conversationMemory.lastMessages.length > 0,
            true,
          );
          await this.markBotResponseInDecisionState(normalizedContactId, result.reply, decision, []);
          await this.persistMicroContext(
            normalizedContactId,
            decision.intent,
            result.reply,
            metadata?.messageType ?? 'text',
          );
          this.logReply(normalizedContactId, result);
          return await finalizeResponseAudited('quick_cache', result);
        }

        quickInfoKindForCache = quickInfoKind;
      }

      const sentMediaState = await this.getSentMediaState(normalizedContactId);
      const knowledgeContext = preloadedKnowledgeContext;

      await this.memoryService.saveMessage({
        contactId: normalizedContactId,
        role: 'user',
        content: normalizedMessage,
      });
      userMessageStored = true;
      await this.rememberLastMessageType(normalizedContactId, metadata?.messageType ?? 'text');

      const memoryContext = await this.memoryService.getConversationContext(
        normalizedContactId,
        memoryWindow,
      );
      const history = this.excludeCurrentUserMessage(
        memoryContext.messages,
        normalizedMessage,
      );
      const conversationMemory = await this.getConversationMemory(normalizedContactId, history);
      const usedMemory = this.hasUsefulMemory(memoryContext, history.length) || conversationMemory.lastMessages.length > 0;
      const conversationEndKey = this.getConversationEndKey(normalizedContactId);
      const conversationWasEnded = Boolean(
        await this.readRedisCache<boolean>(conversationEndKey),
      );
      const resumedByInterest = this.shouldResumeClosedConversation(normalizedMessage);

      if (conversationWasEnded && resumedByInterest) {
        await this.redisService.del(conversationEndKey);
        console.log('CONVERSATION END CLEARED:', normalizedContactId);
      }

      const closureDetected = this.shouldMarkConversationAsEnded(normalizedMessage);
      if ((closureDetected || conversationWasEnded) && !resumedByInterest) {
        if (responseGenerated && finalResult) {
          logResponseDebug({ layer: 'stop', blocked: true, reason: 'response_already_generated' });
          return finalResult;
        }

        await this.redisService.set(
          conversationEndKey,
          true,
          BotService.CONVERSATION_END_TTL_SECONDS,
        );

        const closureDecision = this.buildConversationEndedDecision(normalizedMessage);
        const closureReply = this.buildConversationEndedReply(
          conversationMemory,
          closureDetected,
          this.buildProductValueMiniSnippet({
            product: relevantProduct ?? allProducts[0] ?? null,
            message: normalizedMessage,
          }),
        );

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: closureReply,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: closureReply,
            lastMessages: [normalizedMessage, closureReply],
            lastIntent: closureDecision.intent,
            state: closureDecision.stage,
            lastSentHadVideo: false,
            cooldownMediaUntil: null,
          }),
        );

        const closureResult = this.createResult(
          closureReply,
          'cierre',
          'cierre',
          closureDecision,
          false,
          [],
          'text',
          usedMemory,
        );

        await this.markBotResponseInDecisionState(
          normalizedContactId,
          closureResult.reply,
          closureDecision,
          [],
        );
        await this.persistMicroContext(
          normalizedContactId,
          closureDecision.intent,
          closureResult.reply,
          metadata?.messageType ?? 'text',
        );
        this.logReply(normalizedContactId, closureResult);
        return await finalizeResponseAudited('stop', closureResult);
      }

      const microIntentResult = await this.resolveMicroIntentResult({
        contactId: normalizedContactId,
        message: normalizedMessage,
        conversationMemory,
        memoryContext,
        usedMemory,
      });

      if (microIntentResult) {
        if (responseGenerated && finalResult) {
          logResponseDebug({ layer: 'micro', blocked: true, reason: 'response_already_generated' });
          return finalResult;
        }

        const microValueSnippet = this.buildProductValueMiniSnippet({
          product: relevantProduct ?? allProducts[0] ?? null,
          message: normalizedMessage,
        });
        const microReply = microValueSnippet && allProducts.length > 0 && !this.replyMentionsAnyProduct(microIntentResult.reply, relevantProducts.length > 0 ? relevantProducts : allProducts)
          ? `${microIntentResult.reply} ${microValueSnippet}`.replace(/\s+/g, ' ').trim()
          : microIntentResult.reply;

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: microReply,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: microReply,
            lastMessages: [normalizedMessage, microReply],
            lastIntent: microIntentResult.decision.intent,
            state: microIntentResult.decision.stage,
            lastSentHadVideo: false,
            cooldownMediaUntil: null,
          }),
        );

        const microResult = this.createResult(
          microReply,
          'micro',
          microIntentResult.intent,
          microIntentResult.decision,
          microIntentResult.decision.stage === 'listo',
          [],
          'text',
          usedMemory,
        );

        await this.markBotResponseInDecisionState(
          normalizedContactId,
          microResult.reply,
          microIntentResult.decision,
          [],
        );
        await this.persistMicroContext(
          normalizedContactId,
          microIntentResult.decision.intent,
          microResult.reply,
          metadata?.messageType ?? 'text',
        );
        this.logReply(normalizedContactId, microResult);
        return await finalizeResponseAudited('micro', microResult);
      }

      const earlyMediaIntent = this.detectMediaIntent(normalizedMessage);
      if (
        earlyMediaIntent === null &&
        normalizedMessage.length < BotService.SPEED_NO_AI_MAX_CHARS &&
        this.isCloseSignal(normalizedMessage)
      ) {
        if (responseGenerated && finalResult) {
          logResponseDebug({ layer: 'short_no_ai', blocked: true, reason: 'response_already_generated' });
          return finalResult;
        }

        const shortReply = this.buildShortNoAiReply(relevantProduct ?? allProducts[0] ?? null, normalizedMessage);
        const quickDecision = this.buildQuickDecisionState({
          contactId: normalizedContactId,
          message: normalizedMessage,
          decisionIntent: 'info',
          stage: 'curioso',
          action: 'guiar',
          summary: 'Mensaje corto: respuesta rapida sin IA.',
        });
        const quickIntent = this.mapDecisionIntentToBotIntent(quickDecision.intent, normalizedMessage);

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: shortReply,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: shortReply,
            lastMessages: [normalizedMessage, shortReply],
            lastIntent: quickDecision.intent,
            state: quickDecision.stage,
            lastSentHadVideo: false,
            cooldownMediaUntil: null,
          }),
        );

        const shortResult = this.createResult(
          shortReply,
          'hardcode',
          quickIntent,
          quickDecision,
          false,
          [],
          'text',
          usedMemory,
        );
        await this.markBotResponseInDecisionState(
          normalizedContactId,
          shortResult.reply,
          quickDecision,
          [],
        );
        await this.persistMicroContext(
          normalizedContactId,
          quickDecision.intent,
          shortResult.reply,
          metadata?.messageType ?? 'text',
        );
        this.logReply(normalizedContactId, shortResult);
        return await finalizeResponseAudited('short_no_ai', shortResult);
      }

      const companyData = await this.getCachedCompanyRules();
      const decision = await this.runDecisionEngine({
        contactId: normalizedContactId,
        message: normalizedMessage,
        history,
        memoryContext,
        config,
      });
      const intent = this.mapDecisionIntentToBotIntent(decision.intent, normalizedMessage);
      const normalizedForMatch = this.normalizeTextForMatch(normalizedMessage);
      const isInformationalRequest =
        this.requiresDetailedResponse(normalizedMessage)
        || this.requiresDetailedResponse(normalizedForMatch)
        || decision.intent === 'info';
      const clearHotLeadCarryover =
        memoryContext.clientMemory.lastIntent === 'HOT'
        && isInformationalRequest;
      const stageHotLead =
        decision.stage === 'listo' && (intent === 'hot' || intent === 'compra' || intent === 'cierre');
      const shouldHotLead = this.shouldTreatAsHotLead(
        normalizedMessage,
        intent,
        memoryContext.clientMemory.lastIntent,
      );
      const hotLead = (shouldHotLead || stageHotLead) && !clearHotLeadCarryover;

      if (process.env.BOT_DEBUG_HOTLEAD === '1') {
        console.log('HOTLEAD_DEBUG', {
          message: normalizedMessage,
          normalizedForMatch,
          lastIntent: memoryContext.clientMemory.lastIntent,
          decisionIntent: decision.intent,
          decisionStage: decision.stage,
          mappedIntent: intent,
          shouldHotLead,
          stageHotLead,
          clearHotLeadCarryover,
          hotLead,
        });
      }
      const thinkingAnalysis = this.analyzeAndThink(normalizedMessage, {
        memoryContext,
        conversationMemory,
        decision,
        intent,
        hotLead,
      });
      console.log('THINKING RESULT:', thinkingAnalysis);
      await this.redisService.set(
        this.getAnalysisCacheKey(normalizedContactId),
        {
          ...thinkingAnalysis,
          updatedAt: Date.now(),
        } satisfies AnalysisCacheEntry,
        BotService.ANALYSIS_CACHE_TTL_SECONDS,
      );
      const companyCheck = applyCompanyRules(
        normalizedMessage,
        thinkingAnalysis,
        companyData,
        new Date(Date.now()),
      );
      if (companyCheck.reason) {
        console.log('COMPANY RULE APPLIED:', companyCheck.reason);
      }
      const responseStyle = this.resolveResponseStyleFromDecision(decision, normalizedMessage, intent);
      const leadStage = this.mapDecisionStageToLeadStage(decision.stage, hotLead);
      const replyObjective = this.mapDecisionActionToReplyObjective(decision.action);
      await this.redisService.set(
        this.getNextBestActionCacheKey(normalizedContactId),
        {
          action: thinkingAnalysis.nextBestAction,
          reason: thinkingAnalysis.responseStrategy,
          updatedAt: Date.now(),
        } satisfies NextBestActionCacheEntry,
        BotService.NBA_CACHE_TTL_SECONDS,
      );

      if (!companyCheck.allowResponse && companyCheck.overrideResponse) {
        if (responseGenerated && finalResult) {
          logResponseDebug({ layer: 'company_rule', blocked: true, reason: 'response_already_generated' });
          return finalResult;
        }

        const overrideValueSnippet = this.buildProductValueMiniSnippet({
          product: relevantProduct ?? allProducts[0] ?? null,
          message: normalizedMessage,
        });
        const overrideReply = overrideValueSnippet && allProducts.length > 0
          ? `${companyCheck.overrideResponse} ${overrideValueSnippet}`.replace(/\s+/g, ' ').trim()
          : companyCheck.overrideResponse;

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: overrideReply,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: overrideReply,
            lastMessages: [normalizedMessage, overrideReply],
            lastIntent: decision.intent,
            state: decision.stage,
            lastSentHadVideo: false,
            cooldownMediaUntil: null,
          }),
        );

        const blockedResult = this.createResult(
          overrideReply,
          'fallback',
          intent,
          decision,
          false,
          [],
          'text',
          usedMemory,
        );

        await this.markBotResponseInDecisionState(
          normalizedContactId,
          blockedResult.reply,
          decision,
          [],
        );
        await this.persistMicroContext(
          normalizedContactId,
          decision.intent,
          blockedResult.reply,
          metadata?.messageType ?? 'text',
        );
        this.logReply(normalizedContactId, blockedResult);
        return await finalizeResponseAudited('company_rule', blockedResult);
      }

      const mediaIntent = this.detectMediaIntent(normalizedMessage);
      const productMediaCandidates = relevantProducts.length > 0
        ? relevantProducts
        : allProducts;
      const productMediaFiles = await this.selectProductMedia(
        productMediaCandidates,
        mediaIntent,
        decision.action,
      );
      const galleryMediaFiles = productMediaFiles.length > 0
        ? productMediaFiles
        : await this.selectMedia(normalizedMessage, intent);
      const shouldAttachMedia = this.shouldAttachMediaToAiReply(
        normalizedMessage,
        intent,
        mediaIntent,
        decision.action,
        allProducts.length > 0,
        relevantProducts.length > 0,
      );
      const rawCandidateMediaFiles = shouldAttachMedia
        ? (productMediaFiles.length > 0
          ? productMediaFiles
          : ((mediaIntent || intent === 'catalogo') ? galleryMediaFiles : []))
        : [];
      const candidateMediaFiles = rawCandidateMediaFiles.length > 0
        ? this.filterConversationMediaFiles(
            this.limitOutgoingMediaFiles(rawCandidateMediaFiles, mediaIntent, sentMediaState),
            conversationMemory,
          )
        : [];
      const responseCacheKey = this.getResponseCacheKey(
        this.buildResponseCacheHash(normalizedMessage, decision.intent, decision.stage),
      );
      let cachedResponse = await this.getCachedResponse(responseCacheKey, conversationMemory);
      if (cachedResponse && this.isKnowledgeEnforcementEnabled()) {
        const cacheStats = this.buildAiAuditReplyStats({
          message: normalizedMessage,
          reply: cachedResponse.reply,
          mediaCount: 0,
          allProducts,
          relevantProducts,
          companyDataText: companyDataTextForAudit,
          instructionsText: instructionsTextForAudit,
        });
        if (!cacheStats.ok) {
          this.logger.log(
            JSON.stringify({
              event: 'KNOWLEDGE_ENFORCEMENT',
              contactId: normalizedContactId,
              message: normalizedMessage,
              kind: 'discard_response_cache',
              responseCacheKey,
              failures: [...cacheStats.criticalFailures, ...cacheStats.severeFailures],
            }),
          );
          cachedResponse = null;
          try {
            await this.redisService.del(responseCacheKey);
          } catch {
            // Ignore cache cleanup failures.
          }
        }
      }
      if (cachedResponse) {
        if (responseGenerated && finalResult) {
          logResponseDebug({ layer: 'cache', blocked: true, reason: 'response_already_generated' });
          return finalResult;
        }

        const cachedDecision: BotDecisionState = {
          ...decision,
          intent: cachedResponse.decisionIntent,
          stage: cachedResponse.stage,
          action: cachedResponse.action,
          purchaseIntentScore: cachedResponse.purchaseIntentScore,
          currentIntent: cachedResponse.decisionIntent,
        };
        const cachedResult = this.createResult(
          cachedResponse.reply,
          'cache',
          cachedResponse.intent,
          cachedDecision,
          cachedResponse.hotLead,
          [],
          cachedResponse.replyType,
          usedMemory,
          true,
        );

        await this.memoryService.saveMessage({
          contactId: normalizedContactId,
          role: 'assistant',
          content: cachedResult.reply,
        });
        await this.saveConversationMemory(
          recordConversationDelivery(conversationMemory, {
            messageText: cachedResult.reply,
            lastMessages: [normalizedMessage, cachedResult.reply],
            lastIntent: cachedResponse.decisionIntent,
            state: cachedResponse.stage,
            lastSentHadVideo: false,
            cooldownMediaUntil: null,
          }),
        );
        await this.markBotResponseInDecisionState(
          normalizedContactId,
          cachedResult.reply,
          cachedDecision,
          [],
        );
        await this.persistMicroContext(
          normalizedContactId,
          cachedDecision.intent,
          cachedResult.reply,
          metadata?.messageType ?? 'text',
        );
        this.logReply(normalizedContactId, cachedResult);
        return await finalizeResponseAudited('cache', cachedResult);
      }

      console.log('USANDO IA:', true);
      console.log('CONTEXTO LENGTH:', knowledgeContext.length);
      console.log('EMPRESA CONTEXTO:', knowledgeContext);

      const companyDataText = this.extractBracketSection(knowledgeContext, 'EMPRESA');
      const compactKnowledgeContext = this.buildCompactKnowledgeContext({
        config,
        botConfig,
        relevantProduct: relevantProducts[0] ?? null,
        companyDataText,
      });
      const compactContextKnowledgeContext = this.buildCompactContextKnowledgeContext({
        config,
        botConfig,
        relevantProduct: relevantProducts[0] ?? null,
        companyDataText,
      });
      const compactFullPrompt = this.limitText(this.botConfigService.getFullPrompt(botConfig), 1200);

      let validatedReply: Awaited<ReturnType<BotService['generateValidatedReply']>>;
      try {
        validatedReply = await this.withTimeout(
          this.generateValidatedReply({
            config,
            fullPrompt: compactFullPrompt,
            companyContext: compactKnowledgeContext,
            contactId: normalizedContactId,
            message: normalizedMessage,
            history,
            context: this.buildCombinedConversationContext(compactContextKnowledgeContext, memoryContext, thinkingAnalysis),
            classifiedIntent: decision.intent,
            decisionAction: decision.action,
            purchaseIntentScore: decision.purchaseIntentScore,
            responseStyle,
            leadStage,
            replyObjective,
            thinkingAnalysis,
            companyData,
            companyCheck,
            conversationMemory,
            candidateMediaFiles,
            intent,
            relevantProduct,
            allProducts,
          }),
          BotService.AI_TIMEOUT_MS,
          'ai_generate',
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes('ai_generate_timeout')) {
          const timeoutReply = this.buildSalesActiveFallbackReply(config, normalizedMessage, conversationMemory);

          await this.memoryService.saveMessage({
            contactId: normalizedContactId,
            role: 'assistant',
            content: timeoutReply,
          });
          await this.saveConversationMemory(
            recordConversationDelivery(conversationMemory, {
              messageText: timeoutReply,
              lastMessages: [normalizedMessage, timeoutReply],
              lastIntent: decision.intent,
              state: decision.stage,
              lastSentHadVideo: false,
              cooldownMediaUntil: null,
            }),
          );

          const timeoutResult = this.createResult(
            timeoutReply,
            'fallback',
            intent,
            decision,
            hotLead,
            [],
            'text',
            usedMemory,
          );
          await this.markBotResponseInDecisionState(
            normalizedContactId,
            timeoutResult.reply,
            decision,
            [],
          );
          await this.persistMicroContext(
            normalizedContactId,
            decision.intent,
            timeoutResult.reply,
            metadata?.messageType ?? 'text',
          );
          this.logReply(normalizedContactId, timeoutResult);
          return await finalizeResponseAudited('ai_timeout', timeoutResult);
        }

        throw error;
      }
      const preferredReplyType = this.resolvePreferredReplyType({
        message: normalizedMessage,
        reply: validatedReply.reply.content,
        intent,
        action: decision.action,
        metadata,
      });

      if (quickInfoKindForCache) {
        await this.redisService.set(
          this.getQuickReplyCacheKey(quickInfoKindForCache, relevantProduct?.id ?? null),
          validatedReply.reply.content,
          BotService.QUICK_REPLY_CACHE_TTL_SECONDS,
        );
      }

      await this.memoryService.saveMessage({
        contactId: normalizedContactId,
        role: 'assistant',
        content: validatedReply.reply.content,
      });
      await this.saveConversationMemory(
        recordConversationDelivery(conversationMemory, {
          messageText: validatedReply.reply.content,
          mediaIds: validatedReply.mediaFiles.map((file) => file.fileUrl),
          lastMessages: [normalizedMessage, validatedReply.reply.content],
          lastIntent: decision.intent,
          state: decision.stage,
          lastSentHadVideo: validatedReply.mediaFiles.some((file) => file.fileType === 'video'),
          cooldownMediaUntil:
            validatedReply.mediaFiles.length > 0
              ? Date.now() + BotService.MEDIA_COOLDOWN_MS
              : null,
        }),
      );

      const result = this.createResult(
        validatedReply.reply.content,
        validatedReply.source,
        intent,
        decision,
        hotLead,
        validatedReply.mediaFiles,
        preferredReplyType,
        usedMemory,
      );

      await this.markBotResponseInDecisionState(
        normalizedContactId,
        validatedReply.reply.content,
        decision,
        validatedReply.mediaFiles,
      );
      await this.persistMicroContext(
        normalizedContactId,
        decision.intent,
        result.reply,
        metadata?.messageType ?? 'text',
      );
      console.log('RESPUESTA FINAL:', {
        text: result.reply,
        mediaIds: result.mediaFiles.map((file) => file.fileUrl),
        source: result.source,
      });
      console.log('ENVIADA:', {
        text: result.reply,
        mediaIds: result.mediaFiles.map((file) => file.fileUrl),
      });
      this.logReply(normalizedContactId, result);
      const finalized = await finalizeResponseAudited('ai', result, {
        thinkingAnalysis,
        combinedContextLength: this.buildCombinedConversationContext(
          compactContextKnowledgeContext,
          memoryContext,
          thinkingAnalysis,
        ).length,
        knowledgeContextLength: knowledgeContext.length,
      });
      await this.cacheResponseIfEligible(responseCacheKey, finalized, conversationMemory);
      return finalized;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'bot_process_failed',
          contactId: normalizedContactId,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
        error instanceof Error ? error.stack : undefined,
      );

      if (!userMessageStored) {
        try {
          await this.memoryService.saveMessage({
            contactId: normalizedContactId,
            role: 'user',
            content: normalizedMessage,
          });
        } catch {
          // Ignore fallback persistence failures.
        }
      }

      return this.buildFallbackResult(normalizedContactId, normalizedMessage);
    }
  }

  async runBotTests(): Promise<BotTestReport> {
    const startedAt = Date.now();
    const baseContactId = `__bot_test__${startedAt}`;
    const scenarios: Array<{ scenario: string; contactId: string; messages: string[]; expectGallery: boolean; expectHot: boolean; expectClose: boolean }> = [
      {
        scenario: 'precio',
        contactId: `${baseContactId}-thread`,
        messages: ['precio'],
        expectGallery: false,
        expectHot: false,
        expectClose: false,
      },
      {
        scenario: 'ok',
        contactId: `${baseContactId}-thread`,
        messages: ['ok'],
        expectGallery: false,
        expectHot: false,
        expectClose: true,
      },
      {
        scenario: 'quiero catalogo',
        contactId: `${baseContactId}-thread`,
        messages: ['quiero catálogo'],
        expectGallery: true,
        expectHot: false,
        expectClose: false,
      },
      {
        scenario: 'multiples mensajes',
        contactId: `${baseContactId}-multi`,
        messages: ['hola', 'quiero info', 'precio'],
        expectGallery: false,
        expectHot: false,
        expectClose: false,
      },
      {
        scenario: 'mensaje repetido',
        contactId: `${baseContactId}-repeat`,
        messages: ['precio', 'precio'],
        expectGallery: false,
        expectHot: false,
        expectClose: false,
      },
      {
        scenario: 'hot lead',
        contactId: `${baseContactId}-hot`,
        messages: ['lo quiero'],
        expectGallery: false,
        expectHot: true,
        expectClose: true,
      },
    ];

    const results: BotTestStepResult[] = [];

    for (const scenario of scenarios) {
      try {
        let result: BotReplyResult | undefined;

        for (const message of scenario.messages) {
          result = await this.processIncomingMessage(scenario.contactId, message);
        }

        if (!result) {
          throw new Error('No se genero respuesta');
        }

        const shortReply = this.isShortReply(result.reply);
        const salesClose = this.looksLikeSalesClose(result.reply);
        const stepResult: BotTestStepResult = {
          scenario: scenario.scenario,
          contactId: scenario.contactId,
          messages: scenario.messages,
          passed:
            shortReply &&
            (!scenario.expectGallery || result.usedGallery) &&
            (!scenario.expectHot || result.hotLead) &&
            (!scenario.expectClose || salesClose),
          checks: {
            shortReply,
            usedGallery: !scenario.expectGallery || result.usedGallery,
            detectedHotLead: !scenario.expectHot || result.hotLead,
            salesClose: !scenario.expectClose || salesClose,
          },
          result,
        };

        results.push(stepResult);
      } catch (error) {
        results.push({
          scenario: scenario.scenario,
          contactId: scenario.contactId,
          messages: scenario.messages,
          passed: false,
          checks: {
            shortReply: false,
            usedGallery: !scenario.expectGallery,
            detectedHotLead: !scenario.expectHot,
            salesClose: !scenario.expectClose,
          },
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      ok: results.every((item) => item.passed),
      durationMs: Date.now() - startedAt,
      results,
    };
  }

  async getMediaByKeyword(text: string) {
    return this.mediaService.getMediaByKeyword(text);
  }

  detectIntent(message: string): BotIntent {
    const normalized = message.trim().toLowerCase();

    if (!normalized) {
      return 'otro';
    }

    if (['catalogo', 'catálogo', 'catalog'].some((keyword) => normalized.includes(keyword))) {
      return 'catalogo';
    }

    if (this.detectHotLead(normalized)) {
      return 'hot';
    }

    if (this.requiresDetailedResponse(normalized)) {
      return 'duda';
    }

    if (['funciona', 'calidad', 'sirve', 'garantia', 'garantía', 'resultado', 'resultados'].some((keyword) => normalized.includes(keyword))) {
      return 'duda';
    }

    if (['ok', 'perfecto', 'dale', 'esta bien', 'está bien'].some((keyword) => normalized.includes(keyword))) {
      return 'cierre';
    }

    if (['comprar', 'pedido', 'ordenar'].some((keyword) => normalized.includes(keyword))) {
      return 'compra';
    }

    if (['precio', 'info', 'informacion', 'información', 'detalle', 'detalles', 'quiero', 'necesito', 'me interesa'].some((keyword) => normalized.includes(keyword))) {
      return 'interes';
    }

    return 'otro';
  }

  detectHotLead(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return ['lo quiero', 'dame uno', 'como compro', 'cómo compro', 'lo compro', 'quiero comprar', 'te voy a comprar']
      .some((keyword) => normalized.includes(keyword));
  }

  private buildConversationContext(
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
  ): string {
    const sections: string[] = [];

    if (memoryContext.summary.summary?.trim()) {
      sections.push(`Resumen de la conversacion:\n${memoryContext.summary.summary.trim()}`);
    }

    const memoryLines = [
      memoryContext.clientMemory.name
        ? `Nombre del cliente: ${memoryContext.clientMemory.name}`
        : null,
      memoryContext.clientMemory.objective
        ? `Objetivo principal: ${memoryContext.clientMemory.objective}`
        : null,
      memoryContext.clientMemory.interest
        ? `Interes detectado: ${memoryContext.clientMemory.interest}`
        : null,
      memoryContext.clientMemory.status && memoryContext.clientMemory.status !== 'nuevo'
        ? `Estado del cliente: ${memoryContext.clientMemory.status}`
        : null,
      (memoryContext.clientMemory.objections?.length ?? 0) > 0
        ? `Objeciones detectadas: ${memoryContext.clientMemory.objections.join(', ')}`
        : null,
    ].filter((value): value is string => Boolean(value));

    if (memoryLines.length > 0) {
      sections.push(`Memoria persistente:\n${memoryLines.join('\n')}`);
    }

    if (sections.length === 0) {
      return '';
    }

    sections.push(
      'Usa esta memoria para continuar la conversacion de forma natural, recordar datos del cliente y evitar repetir preguntas ya resueltas.',
    );
    sections.push(
      'Si el cliente ya pregunto precio, responde directo y enfoca el cierre. Si su objetivo es rebajar, resalta resultados. Si hay objeciones, responde con confianza y prueba, sin sonar robotico.',
    );

    return sections.join('\n\n');
  }

  private async getConversationMemory(
    contactId: string,
    history: StoredMessage[],
  ): Promise<ConversationMemoryState> {
    const stored = await this.redisService.get<ConversationMemoryState>(
      getConversationMemoryKey(contactId),
    );

    return normalizeConversationMemory(contactId, stored, {
      sentMessages: history
        .filter((item) => item.role === 'assistant')
        .map((item) => item.content),
      lastMessages: history.map((item) => item.content),
      state: '',
    });
  }

  private async saveConversationMemory(memory: ConversationMemoryState): Promise<void> {
    await this.redisService.set(
      getConversationMemoryKey(memory.contactId),
      memory,
      BotService.CONVERSATION_MEMORY_TTL_SECONDS,
    );
  }

  private filterConversationMediaFiles(
    mediaFiles: MediaFile[],
    conversationMemory: ConversationMemoryState,
  ): MediaFile[] {
    let videoCount = 0;

    return mediaFiles.filter((file) => {
      const mediaId = file.fileUrl.trim();
      if (!mediaId || conversationMemory.sentMedia.includes(mediaId)) {
        return false;
      }

      if (file.fileType !== 'video') {
        return true;
      }

      if (videoCount >= 1) {
        return false;
      }

      videoCount += 1;
      return true;
    });
  }

  private buildRetryInstruction(
    memory: ConversationMemoryState,
    reason: ResponseValidationReason,
    rejectedText?: string,
  ): string {
    return [
      'No repitas el mismo contenido, responde diferente.',
      `Motivo del rechazo anterior: ${reason}.`,
      reason === 'generic_no_product'
        ? 'Tu respuesta fue demasiado generica. Usa informacion concreta del producto (beneficios/uso/precio) antes de guiar a compra.'
        : '',
      reason === 'missing_dual_answer'
        ? 'El cliente pidio "ambas cosas". Debes cubrir beneficios + (uso o precio) en la misma respuesta, de forma clara, antes de guiar.'
        : '',
      reason === 'missing_minimum_product_value'
        ? 'Te falto el MINIMO obligatorio: 1 beneficio real + 1 funcion/como se usa + 1 conexion con la necesidad del cliente ("si lo que buscas es X..."). Incluyelo todo en la misma respuesta.'
        : '',
      reason === 'coherence_mismatch'
        ? 'Dijiste datos que no coinciden con PRODUCTOS/EMPRESA (precio/telefono/afirmaciones). Corrige: usa SOLO los datos reales del contexto, y si falta un dato dilo claro sin inventar.'
        : '',
      reason === 'sales_flow_violation'
        ? 'No puedes cerrar ni vender directo sin antes explicar valor. Primero explica el producto (beneficio + funcion/uso) y luego guias a compra con una sola pregunta.'
        : '',
      reason === 'too_many_questions'
        ? 'Haz MAXIMO 1 pregunta en toda la respuesta (o ninguna si no hace falta).'
        : '',
      rejectedText?.trim() ? `Texto rechazado: ${rejectedText.trim()}` : '',
      memory.sentMessages.length > 0
        ? `Evita estos textos exactos: ${memory.sentMessages.slice(-5).join(' | ')}`
        : '',
      'Si no hay media nueva, responde solo con texto distinto y natural.',
      'Si ya explicaste algo, avanza con otra formulacion o con una pregunta util.',
    ]
      .filter((item) => item.length > 0)
      .join('\n');
  }

  private async generateValidatedReply(params: {
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>;
    fullPrompt: string;
    companyContext: string;
    contactId: string;
    message: string;
    history: StoredMessage[];
    context: string;
    classifiedIntent: BotDecisionIntent;
    decisionAction: BotDecisionAction;
    purchaseIntentScore: number;
    responseStyle: AssistantResponseStyle;
    leadStage: AssistantLeadStage;
    replyObjective: AssistantReplyObjective;
    thinkingAnalysis: ThinkingAnalysis;
    companyData: Awaited<ReturnType<CompanyContextService['getContext']>>;
    companyCheck: CompanyRuleCheck;
    conversationMemory: ConversationMemoryState;
    candidateMediaFiles: MediaFile[];
    intent: BotIntent;
    relevantProduct: StructuredProduct | null;
    allProducts: StructuredProduct[];
  }): Promise<{
    reply: { type: 'text' | 'audio'; content: string };
    mediaFiles: MediaFile[];
    source: BotReplyResult['source'];
  }> {
    if (params.companyCheck.reason === 'require_catalog_media' && params.candidateMediaFiles.length === 0) {
      return {
        reply: {
          type: 'text',
          content: buildCompanyRuleMediaUnavailableResponse(params.companyData),
        },
        mediaFiles: [],
        source: 'fallback',
      };
    }

    let lastRejectedText = '';
    let lastReason: ResponseValidationReason | null = null;
    const correctionTrace: Array<{ attempt: number; reason: string; rejectedText: string }> = [];

    for (let attempt = 0; attempt <= BotService.MAX_REPLY_REGENERATION_ATTEMPTS; attempt += 1) {
      const companyRuleInstruction = buildCompanyRuleInstruction(
        params.message,
        params.companyData,
        params.companyCheck,
      );
      const mergedContext = [
        companyRuleInstruction,
        params.context,
        buildConversationMemoryContext(params.conversationMemory),
        this.buildMediaSelectionContext(params.candidateMediaFiles),
      ]
        .filter((item) => item.trim().length > 0)
        .join('\n\n');

      const candidates = await this.aiService.generateResponses({
        config: params.config,
        fullPrompt: params.fullPrompt,
        companyContext: params.companyContext,
        contactId: params.contactId,
        message: params.message,
        history: params.history,
        context: this.limitText(mergedContext, BotService.AI_CONTEXT_MAX_CHARS),
        classifiedIntent: params.classifiedIntent,
        decisionAction: params.decisionAction,
        purchaseIntentScore: params.purchaseIntentScore,
        responseStyle: params.responseStyle,
        leadStage: params.leadStage,
        replyObjective: params.replyObjective,
        thinkingInstruction: 'Analiza primero, luego responde sin repetir. Usa el análisis para decidir la mejor acción.',
        candidateCount: 3,
        regenerationInstruction:
          attempt > 0 && lastReason
            ? this.buildRetryInstruction(params.conversationMemory, lastReason, lastRejectedText)
            : undefined,
      });

      console.log('RESPUESTAS GENERADAS:', candidates);
      const composerOptions = this.resolveComposerOptions({
        message: params.message,
        responseStyle: params.responseStyle,
        replyObjective: params.replyObjective,
        decisionAction: params.decisionAction,
        thinkingAnalysis: params.thinkingAnalysis,
      });
      const selected = this.decideResponse(
        candidates,
        params.candidateMediaFiles,
        params.conversationMemory,
        composerOptions,
      );

      if (selected) {
        const companyRuleValidation = validateCompanyRuleResponse(
          params.message,
          selected.reply.content,
          params.companyData,
          params.companyCheck,
          selected.mediaFiles.length,
        );
        if (!companyRuleValidation.valid) {
          console.log('RESPUESTA RECHAZADA:', companyRuleValidation.reason ?? 'company_rule_validation_failed');
          lastRejectedText = selected.reply.content;
          lastReason = 'no_new_content';
          correctionTrace.push({
            attempt,
            reason: `company_rule:${companyRuleValidation.reason ?? 'invalid'}`,
            rejectedText: selected.reply.content,
          });
          this.logger.log(
            JSON.stringify({
              event: 'AI_CORRECTION',
              contactId: params.contactId,
              message: params.message,
              attempt,
              kind: 'reject',
              reason: `company_rule:${companyRuleValidation.reason ?? 'invalid'}`,
            }),
          );
          continue;
        }

        const knowledgeQuality = this.validateAiKnowledgeQuality({
          message: params.message,
          reply: selected.reply.content,
          intent: params.intent,
          mediaCount: selected.mediaFiles.length,
          relevantProduct: params.relevantProduct,
          allProducts: params.allProducts,
        });
        if (!knowledgeQuality.valid) {
          const autoCorrected = this.tryAutoCorrectKnowledgeQualityReply({
            message: params.message,
            reply: selected.reply.content,
            reason: knowledgeQuality.reason ?? 'no_new_content',
            relevantProduct: params.relevantProduct,
            allProducts: params.allProducts,
          });

          if (autoCorrected && autoCorrected.trim() && autoCorrected.trim() !== selected.reply.content.trim()) {
            const correctedQuality = this.validateAiKnowledgeQuality({
              message: params.message,
              reply: autoCorrected,
              intent: params.intent,
              mediaCount: selected.mediaFiles.length,
              relevantProduct: params.relevantProduct,
              allProducts: params.allProducts,
            });

            if (correctedQuality.valid) {
              this.logger.log(
                JSON.stringify({
                  event: 'AI_CORRECTION',
                  contactId: params.contactId,
                  message: params.message,
                  attempt,
                  kind: 'auto_patch_accept',
                  reason: `knowledge_quality:${knowledgeQuality.reason ?? 'invalid'}`,
                }),
              );

              return {
                reply: {
                  type: selected.reply.type,
                  content: autoCorrected,
                },
                mediaFiles: selected.mediaFiles,
                source: selected.source,
              };
            }
          }

          console.log('RESPUESTA RECHAZADA:', knowledgeQuality.reason ?? 'knowledge_quality_failed');
          lastRejectedText = selected.reply.content;
          lastReason = knowledgeQuality.reason ?? 'no_new_content';
          correctionTrace.push({
            attempt,
            reason: `knowledge_quality:${knowledgeQuality.reason ?? 'invalid'}`,
            rejectedText: selected.reply.content,
          });
          this.logger.log(
            JSON.stringify({
              event: 'AI_CORRECTION',
              contactId: params.contactId,
              message: params.message,
              attempt,
              kind: 'reject',
              reason: `knowledge_quality:${knowledgeQuality.reason ?? 'invalid'}`,
            }),
          );
          continue;
        }

        console.log('RESPUESTA FINAL:', {
          text: selected.reply.content,
          mediaIds: selected.mediaFiles.map((file) => file.fileUrl),
          source: selected.source,
        });

        if (correctionTrace.length > 0) {
          const rejected = correctionTrace[0]?.rejectedText ?? '';
          const accepted = selected.reply.content;
          const rejectedNorm = this.normalizeTextForMatch(rejected);
          const acceptedNorm = this.normalizeTextForMatch(accepted);
          const productTitle = params.relevantProduct?.titulo?.trim() ?? '';
          const productNorm = productTitle ? this.normalizeTextForMatch(productTitle) : '';
          const added: string[] = [];
          if (productNorm && acceptedNorm.includes(productNorm) && !rejectedNorm.includes(productNorm)) {
            added.push('added_product_name');
          }
          const knownPriceStrings = params.allProducts
            .flatMap((product) => [this.valueToText(product.precio), this.valueToText(product.precioMinimo)])
            .map((value) => (value ?? '').trim())
            .filter((value) => value.length > 0);
          const hadKnownPrice = knownPriceStrings.some((value) => rejected.toLowerCase().includes(value.toLowerCase()));
          const hasKnownPrice = knownPriceStrings.some((value) => accepted.toLowerCase().includes(value.toLowerCase()));
          if (hasKnownPrice && !hadKnownPrice) {
            added.push('added_real_price');
          }
          const addedFunction = acceptedNorm.includes('funciona') && !rejectedNorm.includes('funciona');
          if (addedFunction) {
            added.push('added_function');
          }
          const addedBenefit = acceptedNorm.includes('ayuda') && !rejectedNorm.includes('ayuda');
          if (addedBenefit) {
            added.push('added_benefit');
          }
          const addedConnection = acceptedNorm.includes('si lo que buscas') && !rejectedNorm.includes('si lo que buscas');
          if (addedConnection) {
            added.push('added_need_connection');
          }

          this.logger.log(
            JSON.stringify({
              event: 'AI_CORRECTION',
              contactId: params.contactId,
              message: params.message,
              kind: 'accepted_after_corrections',
              corrections: correctionTrace.map((item) => ({ attempt: item.attempt, reason: item.reason })),
              added,
            }),
          );
        }

        return selected;
      }

      const candidateFallback = this.tryBuildMediaCandidateFallback(
        params.candidateMediaFiles,
        params.conversationMemory,
      );
      if (candidateFallback) {
        console.log('RESPUESTA FINAL:', {
          text: candidateFallback.reply.content,
          mediaIds: candidateFallback.mediaFiles.map((file) => file.fileUrl),
          source: candidateFallback.source,
        });
        return candidateFallback;
      }

      lastRejectedText = candidates[0]?.text ?? '';
      lastReason = this.getLastCandidateRejectionReason(
        candidates,
        params.candidateMediaFiles,
        params.conversationMemory,
      );
    }

    return {
      reply: {
        type: 'text',
        content: this.buildNonRepeatingQuestion(
          params.message,
          params.intent,
          params.conversationMemory,
        ),
      },
      mediaFiles: [],
      source: 'fallback',
    };
  }

  private tryAutoCorrectKnowledgeQualityReply(params: {
    message: string;
    reply: string;
    reason: ResponseValidationReason;
    relevantProduct: StructuredProduct | null;
    allProducts: StructuredProduct[];
  }): string | null {
    const featuredProduct = params.relevantProduct ?? params.allProducts[0] ?? null;
    if (!featuredProduct) {
      return null;
    }

    const valueSnippet = this.buildProductValueMiniSnippet({
      product: featuredProduct,
      message: params.message,
    });

    const replyTrimmed = params.reply.trim();
    const replyNormalized = this.normalizeTextForMatch(replyTrimmed);
    const questionCount = (replyTrimmed.match(/\?/g) ?? []).length;
    const hasQuestion = questionCount > 0;

    const knownPriceText = this.valueToText(featuredProduct.precio);

    const shouldAttempt = [
      'generic_no_product',
      'missing_dual_answer',
      'missing_minimum_product_value',
      'sales_flow_violation',
      'coherence_mismatch',
    ].includes(params.reason);

    if (!shouldAttempt) {
      return null;
    }

    if (params.reason === 'coherence_mismatch') {
      if (!knownPriceText) {
        return null;
      }

      if (replyTrimmed.toLowerCase().includes(knownPriceText.toLowerCase())) {
        return null;
      }

      const suffix = `Precio: ${knownPriceText}.`;
      return [replyTrimmed, suffix].filter(Boolean).join('\n\n').trim();
    }

    if (params.reason === 'generic_no_product') {
      if (!valueSnippet) {
        return null;
      }

      const callToAction = hasQuestion
        ? ''
        : '¿Qué buscas lograr o qué duda tienes?';

      return [valueSnippet, callToAction]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    if (params.reason === 'missing_dual_answer') {
      const usageLine = replyNormalized.includes('se usa') || replyNormalized.includes('se toma')
        ? ''
        : 'Se usa como una infusión (1 taza al día) para empezar.';

      const priceLine = knownPriceText && !replyTrimmed.toLowerCase().includes(knownPriceText.toLowerCase())
        ? `Precio: ${knownPriceText}.`
        : '';

      const callToAction = hasQuestion
        ? ''
        : '¿Quieres que te diga cómo pedirlo?';

      return [replyTrimmed, usageLine, priceLine, valueSnippet, callToAction]
        .filter(Boolean)
        .join('\n\n')
        .trim();
    }

    if (!valueSnippet) {
      return null;
    }

    const alreadyHasSnippet = replyNormalized.includes(this.normalizeTextForMatch(valueSnippet));
    const appended = alreadyHasSnippet
      ? replyTrimmed
      : [replyTrimmed, valueSnippet].filter(Boolean).join('\n\n').trim();

    if (!hasQuestion) {
      return appended;
    }

    return appended;
  }

  private decideResponse(
    candidates: AssistantResponseCandidate[],
    candidateMediaFiles: MediaFile[],
    conversationMemory: ConversationMemoryState,
    composerOptions: ComposeOptions,
  ): {
    reply: { type: 'text' | 'audio'; content: string };
    mediaFiles: MediaFile[];
    source: BotReplyResult['source'];
  } | null {
    const discarded: Array<{ index: number; reason: string }> = [];
    const valid: Array<{ index: number; candidate: AssistantResponseCandidate; mediaFiles: MediaFile[] }> = [];

    for (const [index, candidate] of candidates.entries()) {
      const selectedMediaFiles = this.resolveCandidateMediaFiles(candidate, candidateMediaFiles);
      const validation = validateResponseCandidate(
        {
          text: candidate.text,
          mediaIds: selectedMediaFiles.map((file) => file.fileUrl),
          videoIds: selectedMediaFiles
            .filter((file) => file.fileType === 'video')
            .map((file) => file.fileUrl),
        },
        conversationMemory,
      );

      if (!validation.valid) {
        const reason = validation.reason ?? 'no_new_content';
        discarded.push({ index, reason: `validation_failed:${reason}` });
        console.log('RESPUESTA RECHAZADA:', reason);
        continue;
      }

      valid.push({ index, candidate, mediaFiles: selectedMediaFiles });
    }

    if (valid.length === 0) {
      this.logger.log(
        JSON.stringify({
          event: 'RESPONSE_COMPOSER',
          total_respuestas: candidates.length,
          seleccionada: null,
          descartadas: discarded,
        }),
      );
      return null;
    }

    const selection = selectBestResponseWithOptions(valid.map((item) => item.candidate.text), composerOptions);
    const picked = valid[Math.max(0, Math.min(selection.selectedIndex, valid.length - 1))];
    const finalText =
      composeFinalMessage(picked.candidate.text, composerOptions) || picked.candidate.text.trim();

    for (const item of valid) {
      if (item.index === picked.index) {
        continue;
      }
      discarded.push({ index: item.index, reason: 'lower_score' });
    }

    this.logger.log(
      JSON.stringify({
        event: 'RESPONSE_COMPOSER',
        total_respuestas: candidates.length,
        seleccionada: picked.index,
        descartadas: discarded,
      }),
    );

    return {
      reply: {
        type: picked.candidate.type === 'audio' ? 'audio' : 'text',
        content: finalText,
      },
      mediaFiles: picked.mediaFiles,
      source: 'ai',
    };
  }

  private resolveComposerOptions(params: {
    message: string;
    responseStyle: AssistantResponseStyle;
    replyObjective: AssistantReplyObjective;
    decisionAction: BotDecisionAction;
    thinkingAnalysis?: ThinkingAnalysis;
  }): ComposeOptions {
    const detailedRequest = this.requiresDetailedResponse(params.message);
    const shouldExplain = params.thinkingAnalysis?.nextBestAction === 'explicar' || params.replyObjective === 'resolver_duda';

    if (params.responseStyle === 'detailed' || detailedRequest || shouldExplain) {
      return { maxIdeas: 5, maxQuestions: 1 };
    }

    if (params.responseStyle === 'balanced' || params.replyObjective === 'generar_confianza') {
      return { maxIdeas: 3, maxQuestions: 1 };
    }

    // brief / close
    return { maxIdeas: 2, maxQuestions: 1 };
  }

  private getLastCandidateRejectionReason(
    candidates: AssistantResponseCandidate[],
    candidateMediaFiles: MediaFile[],
    conversationMemory: ConversationMemoryState,
  ): ResponseValidationReason {
    for (const candidate of candidates) {
      const selectedMediaFiles = this.resolveCandidateMediaFiles(candidate, candidateMediaFiles);
      const validation = validateResponseCandidate(
        {
          text: candidate.text,
          mediaIds: selectedMediaFiles.map((file) => file.fileUrl),
          videoIds: selectedMediaFiles
            .filter((file) => file.fileType === 'video')
            .map((file) => file.fileUrl),
        },
        conversationMemory,
      );

      if (!validation.valid) {
        return validation.reason ?? 'no_new_content';
      }
    }

    return 'no_new_content';
  }

  private resolveCandidateMediaFiles(
    candidate: AssistantResponseCandidate,
    candidateMediaFiles: MediaFile[],
  ): MediaFile[] {
    if (candidate.videoId) {
      const selectedVideo = candidateMediaFiles.find(
        (file) => file.fileType === 'video' && file.fileUrl === candidate.videoId,
      );
      return selectedVideo ? [selectedVideo] : [];
    }

    if (candidate.imageId) {
      const selectedImage = candidateMediaFiles.find(
        (file) => file.fileType === 'image' && file.fileUrl === candidate.imageId,
      );
      return selectedImage ? [selectedImage] : [];
    }

    return candidateMediaFiles;
  }

  private buildMediaSelectionContext(mediaFiles: MediaFile[]): string {
    if (mediaFiles.length === 0) {
      return '';
    }

    return [
      '[MEDIA_DISPONIBLE]',
      ...mediaFiles.map((file) => {
        const kind = file.fileType === 'video' ? 'video' : 'image';
        return `- ${kind}: ${file.fileUrl}`;
      }),
      'Si eliges una media, usa exactamente la URL como videoId o imageId.',
      'Si no hace falta media nueva, omite videoId e imageId.',
    ].join('\n');
  }

  private tryBuildMediaCandidateFallback(
    candidateMediaFiles: MediaFile[],
    conversationMemory: ConversationMemoryState,
  ): {
    reply: { type: 'text' | 'audio'; content: string };
    mediaFiles: MediaFile[];
    source: BotReplyResult['source'];
  } | null {
    if (candidateMediaFiles.length === 0) {
      return null;
    }

    const mediaText = this.buildNonRepeatingMediaText(candidateMediaFiles, conversationMemory);
    if (!mediaText) {
      return null;
    }

    const validation = validateResponseCandidate(
      {
        text: mediaText,
        mediaIds: candidateMediaFiles.map((file) => file.fileUrl),
        videoIds: candidateMediaFiles
          .filter((file) => file.fileType === 'video')
          .map((file) => file.fileUrl),
      },
      conversationMemory,
    );

    if (!validation.valid) {
      console.log('RESPUESTA RECHAZADA:', validation.reason ?? 'no_new_content');
      return null;
    }

    return {
      reply: {
        type: 'text',
        content: mediaText,
      },
      mediaFiles: candidateMediaFiles,
      source: 'ai',
    };
  }

  private pickFirstUnsentMessage(options: string[], sentMessages: string[]): string {
    const normalizedOptions = options
      .map((option) => option.trim())
      .filter((option) => option.length > 0);

    return normalizedOptions.find((option) => !sentMessages.includes(option))
      ?? normalizedOptions[0]
      ?? 'Quieres que te ayude por precio, resultados o como se usa?';
  }

  private buildNonRepeatingQuestion(
    message: string,
    intent: BotIntent,
    conversationMemory: ConversationMemoryState,
  ): string {
    const normalized = this.normalizeTextForMatch(message);

    if (intent === 'duda' || normalized.includes('funciona') || normalized.includes('sirve')) {
      return this.pickFirstUnsentMessage([
        'Que duda te preocupa mas ahora, si funciona, como se usa o en cuanto tiempo se nota?',
        'Quieres que te aclare primero si funciona, como se toma o que resultados suele notar la gente?',
        'Dime que parte quieres que te explique mejor: funcionamiento, uso o resultados?',
      ], conversationMemory.sentMessages);
    }

    if (intent === 'compra' || intent === 'interes' || normalized.includes('precio')) {
      return this.pickFirstUnsentMessage([
        'Que te interesa mas ahora, precio, resultados o como pedirlo?',
        'Quieres que te diga primero el precio, como se usa o como seria el pedido?',
        'Prefieres que te explique precio, uso o la forma de envio?',
      ], conversationMemory.sentMessages);
    }

    return this.pickFirstUnsentMessage([
      'Que quieres ver ahora, precio, fotos o como funciona?',
      'Quieres que te ayude por precio, resultados o modo de uso?',
      'Dime que prefieres que te explique primero: precio, uso o resultados?',
    ], conversationMemory.sentMessages);
  }

  private buildNonRepeatingMediaText(
    mediaFiles: MediaFile[],
    conversationMemory: ConversationMemoryState,
  ): string | null {
    if (mediaFiles.some((file) => file.fileType === 'video')) {
      return this.pickFirstUnsentMessage([
        'Te dejo este video para que lo veas mejor 👆',
        'Mira este video y me dices que te parece 👆',
        'Te mando este video para que lo veas claro 👆',
      ], conversationMemory.sentMessages);
    }

    if (mediaFiles.some((file) => file.fileType === 'image')) {
      return this.pickFirstUnsentMessage([
        'Te dejo otra referencia por aquí 👇',
        'Mira esta otra imagen para que lo veas mejor 👇',
        'Te mando otra referencia visual 👇',
      ], conversationMemory.sentMessages);
    }

    return null;
  }

  private buildFallbackDecisionState(contactId: string, message: string): BotDecisionState {
    return {
      intent: 'otro',
      classificationSource: 'heuristic_fallback',
      stage: 'curioso',
      action: 'guiar',
      purchaseIntentScore: 0,
      currentIntent: 'otro',
      summaryText: 'Fallback temporal por error interno.',
      keyFacts: {},
      lastMessageId: this.buildSyntheticMessageId(contactId, message),
    };
  }

  private async handleClosedConversationForSpeedPath(params: {
    contactId: string;
    message: string;
    messageType: 'text' | 'audio' | 'image';
    featuredProduct: StructuredProduct | null;
  }): Promise<BotReplyResult | null> {
    const conversationEndKey = this.getConversationEndKey(params.contactId);
    const conversationWasEnded = Boolean(await this.readRedisCache<boolean>(conversationEndKey));
    if (!conversationWasEnded) {
      return null;
    }

    const resumedByInterest = this.shouldResumeClosedConversation(params.message);
    if (resumedByInterest) {
      await this.redisService.del(conversationEndKey);
      return null;
    }

    await this.memoryService.saveMessage({
      contactId: params.contactId,
      role: 'user',
      content: params.message,
    });
    await this.rememberLastMessageType(params.contactId, params.messageType);

    const conversationMemory = await this.getConversationMemory(params.contactId, []);
    const closureDecision = this.buildConversationEndedDecision(params.message);
    const closureReply = this.buildConversationEndedReply(
      conversationMemory,
      false,
      this.buildProductValueMiniSnippet({
        product: params.featuredProduct,
        message: params.message,
      }),
    );

    await this.memoryService.saveMessage({
      contactId: params.contactId,
      role: 'assistant',
      content: closureReply,
    });
    await this.saveConversationMemory(
      recordConversationDelivery(conversationMemory, {
        messageText: closureReply,
        lastMessages: [params.message, closureReply],
        lastIntent: closureDecision.intent,
        state: closureDecision.stage,
        lastSentHadVideo: false,
        cooldownMediaUntil: null,
      }),
    );

    const usedMemory = conversationMemory.lastMessages.length > 0;
    const closureResult = this.createResult(
      closureReply,
      'cierre',
      'cierre',
      closureDecision,
      false,
      [],
      'text',
      usedMemory,
    );

    await this.markBotResponseInDecisionState(
      params.contactId,
      closureResult.reply,
      closureDecision,
      [],
    );
    await this.persistMicroContext(
      params.contactId,
      closureDecision.intent,
      closureResult.reply,
      params.messageType,
    );
    this.logReply(params.contactId, closureResult);
    return closureResult;
  }

  private buildQuickDecisionState(params: {
    contactId: string;
    message: string;
    decisionIntent: BotDecisionIntent;
    stage?: ContactStage;
    action?: BotDecisionAction;
    summary?: string;
  }): BotDecisionState {
    return {
      intent: params.decisionIntent,
      classificationSource: 'rules',
      stage: params.stage ?? 'curioso',
      action: params.action ?? 'guiar',
      purchaseIntentScore: 0,
      currentIntent: params.decisionIntent,
      summaryText: params.summary ?? 'Respuesta rapida sin IA.',
      keyFacts: {},
      lastMessageId: this.buildSyntheticMessageId(params.contactId, params.message),
    };
  }

  private isSpeedGreetingMessage(message: string): boolean {
    return this.isGreetingOnlyMessage(message);
  }

  private detectSpeedKind(message: string): 'price' | 'hours' | 'location' | 'payment' | null {
    const normalized = this.normalizeTextForMatch(message);
    if (!normalized) {
      return null;
    }

    const raw = message.trim().toLowerCase();

    if (
      [
        'precio',
        'cuanto cuesta',
        'cuánto cuesta',
        'cuanto vale',
        'cuánto vale',
        'cuanto sale',
        'cuánto sale',
      ].includes(raw)
    ) {
      return 'price';
    }

    if (normalized.includes('horario')) {
      return 'hours';
    }

    if (normalized.includes('donde estan') || normalized.includes('ubicacion') || normalized.includes('ubicados')) {
      return 'location';
    }

    if (
      normalized.includes('como pago') ||
      normalized.includes('como se paga') ||
      normalized.includes('metodo de pago') ||
      normalized.includes('metodos de pago') ||
      normalized.includes('cuenta') ||
      normalized.includes('transfer') ||
      normalized.includes('deposito')
    ) {
      return 'payment';
    }

    return null;
  }

  private detectQuickInfoKind(message: string): 'benefits' | 'usage' | null {
    const normalized = this.normalizeTextForMatch(message);
    if (!normalized) {
      return null;
    }

    // Only treat as a quick-info request when it's a short, direct question.
    // Longer messages usually need richer AI handling (objections, context, follow-ups).
    if (normalized.length > 50) {
      return null;
    }

    const mediaTerms = ['foto', 'fotos', 'imagen', 'imagenes', 'video', 'videos', 'catalogo', 'catálogo'];
    if (mediaTerms.some((term) => normalized.includes(term))) {
      return null;
    }

    const usageTerms = ['como se usa', 'como se toma', 'modo de uso', 'como tomar', 'como lo tomo', 'como lo uso'];
    if (usageTerms.some((term) => normalized.includes(term))) {
      return 'usage';
    }

    const benefitTerms = ['beneficios', 'resultado', 'resultados', 'para que sirve', 'para que es', 'funciona', 'sirve'];
    if (benefitTerms.some((term) => normalized.includes(term))) {
      return 'benefits';
    }

    return null;
  }

  private getQuickReplyCacheKey(kind: string, productId: string | null): string {
    const suffix = productId?.trim() ? `:${this.hashValue(productId.trim()).slice(0, 12)}` : '';
    return `${BotService.QUICK_REPLY_CACHE_KEY_PREFIX}${kind}${suffix}`;
  }

  private limitText(value: string, maxChars: number): string {
    const normalized = (value ?? '').trim();
    if (!normalized) {
      return '';
    }

    if (normalized.length <= maxChars) {
      return normalized;
    }

    return `${normalized.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    const ms = Math.max(1, timeoutMs);
    let timeoutHandle: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`${label}_timeout`));
      }, ms);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private buildSpeedGreetingReply(): string {
    return 'Hola 👋\n¿Buscas bajar de peso o quieres info?';
  }

  private parseCompanyNameFromCompanyDataText(companyDataText: string): string {
    const text = (companyDataText || '').trim();
    if (!text) {
      return '';
    }

    const match = text.match(/(?:^|\n)Nombre:\s*([^\n]+)/i);
    return (match?.[1] ?? '').trim();
  }

  private buildSpeedGreetingReplyWithContext(params: {
    companyName: string;
    productSnippet: string;
  }): string {
    const header = params.companyName
      ? `Hola 👋 Soy de ${params.companyName}.`
      : 'Hola 👋';

    const example = params.productSnippet ? params.productSnippet.trim() : '';

    const lines = [
      header,
      ['¿Buscas bajar de peso o quieres info?', example].filter(Boolean).join(' '),
    ].filter(Boolean);

    return lines
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .join('\n')
      .trim();
  }

  private buildShortNoAiReply(product: StructuredProduct | null, message: string): string {
    const valueSnippet = this.buildProductValueMiniSnippet({
      product,
      message,
    });
    const prefix = valueSnippet ? `Perfecto. ${valueSnippet}` : 'Perfecto.';
    // Keep max 1 question.
    return `${prefix} ¿Quieres saber precio, como se usa o resultados?`;
  }

  private isAiAuditEnabled(): boolean {
    const raw = (process.env.BOT_AI_AUDIT ?? '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  private isAiAuditStrict(): boolean {
    const raw = (process.env.BOT_AI_AUDIT_STRICT ?? '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  private isAiAuditForceBlock(): boolean {
    const raw = (process.env.BOT_AI_AUDIT_FORCE_BLOCK ?? '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  private isKnowledgeEnforcementEnabled(): boolean {
    const raw = (process.env.BOT_KNOWLEDGE_ENFORCE ?? '').trim().toLowerCase();
    if (!raw) {
      return true;
    }

    return !(raw === '0' || raw === 'false' || raw === 'no' || raw === 'off');
  }

  private auditLog(payload: Record<string, unknown>): void {
    if (!this.isAiAuditEnabled()) {
      return;
    }

    this.logger.log(
      JSON.stringify({
        event: 'AI_AUDIT',
        ...payload,
      }),
    );
  }

  private buildAiAuditModuleStats(params: {
    message: string;
    knowledgeContext: string;
    instructionsText: string;
    allProducts: StructuredProduct[];
    companyDataText: string;
  }): {
    ok: boolean;
    missing: Array<'INSTRUCCIONES' | 'PRODUCTOS' | 'EMPRESA'>;
    counts: {
      instruccionesChars: number;
      productosCount: number;
      empresaChars: number;
    };
    sections: {
      hasInstrucciones: boolean;
      hasProductos: boolean;
      hasEmpresa: boolean;
    };
  } {
    const knowledge = params.knowledgeContext || '';
    const hasInstrucciones = knowledge.includes('[INSTRUCCIONES]');
    const hasProductos = knowledge.includes('[PRODUCTOS]');
    const hasEmpresa = knowledge.includes('[EMPRESA]');

    const companyApplicable = this.detectCompanyApplicability(params.message);
    const requireEmpresa = companyApplicable !== null;

    const messageNormalized = this.normalizeTextForMatch(params.message);
    const companyOnlyTerms = [
      'ubicacion',
      'ubicación',
      'direccion',
      'dirección',
      'horario',
      'telefono',
      'teléfono',
      'whatsapp',
      'pago',
      'cuenta',
      'transferencia',
      'tarjeta',
    ];
    const isCompanyOnly = companyOnlyTerms.some((term) => messageNormalized.includes(this.normalizeTextForMatch(term)));
    const requireProductos = !isCompanyOnly;

    const missing: Array<'INSTRUCCIONES' | 'PRODUCTOS' | 'EMPRESA'> = [];
    if (!hasInstrucciones) {
      missing.push('INSTRUCCIONES');
    }
    if (requireProductos && !hasProductos) {
      missing.push('PRODUCTOS');
    }
    if (requireEmpresa && !hasEmpresa) {
      missing.push('EMPRESA');
    }

    return {
      ok: missing.length === 0,
      missing,
      counts: {
        instruccionesChars: params.instructionsText.trim().length,
        productosCount: requireProductos && Array.isArray(params.allProducts) ? params.allProducts.length : 0,
        empresaChars: requireEmpresa ? params.companyDataText.trim().length : 0,
      },
      sections: {
        hasInstrucciones,
        hasProductos,
        hasEmpresa,
      },
    };
  }

  private replyMentionsAnyProduct(reply: string, products: StructuredProduct[]): boolean {
    const normalizedReply = this.normalizeTextForMatch(reply);
    if (!normalizedReply || products.length === 0) {
      return false;
    }

    for (const product of products) {
      const title = (product.titulo || '').trim();
      if (!title) {
        continue;
      }

      const normalizedTitle = this.normalizeTextForMatch(title);
      if (normalizedTitle && normalizedReply.includes(normalizedTitle)) {
        return true;
      }

      const prices = [this.valueToText(product.precio), this.valueToText(product.precioMinimo)]
        .map((value) => (value || '').trim())
        .filter((value) => value.length > 0);
      if (prices.some((price) => reply.toLowerCase().includes(price.toLowerCase()))) {
        return true;
      }
    }

    return false;
  }

  private detectCompanyApplicability(message: string): 'location' | 'hours' | 'payment' | 'contact' | null {
    const normalized = this.normalizeTextForMatch(message);
    if (!normalized) {
      return null;
    }

    if (/(ubicacion|ubicación|direccion|dirección|donde|dónde|maps)/i.test(message) || normalized.includes('direccion') || normalized.includes('ubicacion')) {
      return 'location';
    }
    if (/(horario|hora|abren|abierto|cierran|cierre)/i.test(message) || normalized.includes('horario')) {
      return 'hours';
    }
    if (/(pago|transferencia|efectivo|cuenta|banco)/i.test(message) || normalized.includes('pago')) {
      return 'payment';
    }
    if (/(telefono|teléfono|whatsapp|contacto)/i.test(message) || normalized.includes('whatsapp') || normalized.includes('telefono')) {
      return 'contact';
    }

    return null;
  }

  private inferNeedsFromNormalizedMessage(messageNormalized: string): string[] {
    const needs = [
      messageNormalized.includes('bajar de peso') || messageNormalized.includes('rebajar') || messageNormalized.includes('adelgaz')
        ? 'bajar de peso'
        : null,
      messageNormalized.includes('digest') || messageNormalized.includes('digestion')
        ? 'digestion'
        : null,
      messageNormalized.includes('bienestar')
        ? 'bienestar'
        : null,
    ].filter((value): value is string => Boolean(value));

    return Array.from(new Set(needs));
  }

  private hasNeedConnection(params: {
    normalizedReply: string;
    questionCount: number;
    needs: string[];
    connectionPhrases?: string[];
  }): boolean {
    const normalizedReply = params.normalizedReply;
    if (!normalizedReply) {
      return false;
    }

    const connectionPhrases = params.connectionPhrases ?? [
      'si lo que buscas',
      'para ti',
      'en tu caso',
      'segun lo que me dices',
      'ya sabes',
      'si te preocupa',
      'si te interesa',
      'lo importante es',
    ];

    return (
      connectionPhrases.some((phrase) => normalizedReply.includes(this.normalizeTextForMatch(phrase)))
      || (params.needs.length > 0
        ? params.needs.some((need) => normalizedReply.includes(this.normalizeTextForMatch(need)))
        : params.questionCount >= 1)
    );
  }

  private tokenizeNormalized(text: string, params: { minTokenLength: number; maxTokens: number }): string[] {
    if (!text?.trim()) {
      return [];
    }

    return text
      .replace(/[\r\n]/g, ' ')
      .split(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= params.minTokenLength)
      .slice(0, params.maxTokens)
      .map((token) => this.normalizeTextForMatch(token));
  }

  private replyMentionsPrice(reply: string, normalizedReply: string): boolean {
    if (!normalizedReply) {
      return false;
    }

    const hasCurrencyMarker = /\brd\$|\busd\b|\$\s*\d/i.test(reply);
    const hasLargeNumber = /\b\d{3,}\b/.test(normalizedReply);
    const hasMoneyWord = /\b(peso|pesos|rd|usd|dolar|dólar|dolares|dólares)\b/i.test(reply);
    const hasExplicitPriceStatement = /\b(cuesta|vale)\b/i.test(reply) || /\bprecio\s*[:=]/i.test(reply);

    return (
      hasCurrencyMarker
      || (hasLargeNumber && hasMoneyWord)
      || (hasExplicitPriceStatement && hasLargeNumber)
    );
  }

  private hasKnownPriceIfMentionsPrice(params: {
    reply: string;
    normalizedReply: string;
    products: StructuredProduct[];
    replyMentionsPrice: boolean;
  }): boolean {
    if (!params.replyMentionsPrice) {
      return true;
    }

    const knownPriceStrings = params.products
      .flatMap((product) => [this.valueToText(product.precio), this.valueToText(product.precioMinimo)])
      .map((value) => (value ?? '').trim())
      .filter((value) => value.length > 0);

    const normalizeMoneyNumber = (value: string): number | null => {
      const digitsOnly = value.replace(/[^0-9]/g, '');
      if (!digitsOnly) {
        return null;
      }
      const num = Number.parseInt(digitsOnly, 10);
      return Number.isFinite(num) ? num : null;
    };

    const extractedMoneyNumbers = (params.reply.match(/\b\d[\d.,]{2,}\b/g) ?? [])
      .map((value) => normalizeMoneyNumber(value))
      .filter((value): value is number => typeof value === 'number');

    const knownMoneyNumbers = params.products
      .flatMap((product) => [product.precio, product.precioMinimo])
      .map((value) => (typeof value === 'number' ? value : normalizeMoneyNumber(String(value ?? ''))))
      .filter((value): value is number => typeof value === 'number');

    return (
      knownPriceStrings.some((value) => params.reply.toLowerCase().includes(value.toLowerCase()))
      || (extractedMoneyNumbers.length > 0 && knownMoneyNumbers.some((known) => extractedMoneyNumbers.includes(known)))
      || params.normalizedReply.includes('no tengo el precio')
      || params.normalizedReply.includes('no esta configurado')
      || params.normalizedReply.includes('no está configurado')
    );
  }

  private buildAiAuditReplyStats(params: {
    message: string;
    reply: string;
    mediaCount: number;
    allProducts: StructuredProduct[];
    relevantProducts: StructuredProduct[];
    companyDataText: string;
    instructionsText: string;
  }): {
    ok: boolean;
    severeFailures: string[];
    criticalFailures: string[];
    warnings: string[];
    checks: {
      usesProducts: boolean;
      respectsInstructions: boolean;
      usesCompanyIfApplies: boolean;
      genericWithoutKnowledge: boolean;
      hasBenefit: boolean;
      hasFunction: boolean;
      hasNeedConnection: boolean;
      coherentWithProducts: boolean;
      salesFlowOk: boolean;
    };
  } {
    const reply = (params.reply || '').trim();
    const relevantPool = params.relevantProducts.length > 0 ? params.relevantProducts : params.allProducts;

    const messageNormalized = this.normalizeTextForMatch(params.message);

    const intent = this.detectIntent(params.message);
    const isGreetingOnly = this.isGreetingOnlyMessage(params.message);
    const companyApplicable = this.detectCompanyApplicability(params.message);
    const hasRelevantProducts = params.allProducts.length > 0 && this.filterRelevantProducts(params.allProducts, params.message).length > 0;
    const hasGenericProductSignal = Boolean(messageNormalized) && [
      'precio',
      'cuanto',
      'cuánto',
      'vale',
      'cuesta',
      'beneficio',
      'beneficios',
      'como se usa',
      'cómo se usa',
      'modo de uso',
      'instrucciones',
      'funciona',
      'sirve',
      'resultado',
      'resultados',
      'rebajar',
      'bajar de peso',
      'adelgaz',
      'comprar',
      'pedido',
      'ordenar',
      'lo quiero',
      'me interesa',
      'informacion',
      'información',
      'info',
      'detalle',
      'detalles',
    ].some((keyword) => messageNormalized.includes(this.normalizeTextForMatch(keyword)));

    // Only require PRODUCTOS-based value when the user's message is actually about products.
    // Greetings, closure acknowledgements, and company-only questions should not be blocked.
    const isCompanyOnlyQuestion = companyApplicable !== null && !hasRelevantProducts && !hasGenericProductSignal;
    const requiresProductValue =
      params.allProducts.length > 0
      && !isGreetingOnly
      && intent !== 'cierre'
      && !isCompanyOnlyQuestion
      && (hasRelevantProducts || hasGenericProductSignal || intent === 'hot' || intent === 'compra' || intent === 'interes' || intent === 'duda');

    const usesProducts = params.allProducts.length === 0
      ? false
      : this.replyMentionsAnyProduct(reply, relevantPool);

    const questionCount = (reply.match(/\?/g) ?? []).length;
    const hasBracketTags = /\[(INSTRUCCIONES|PRODUCTOS|EMPRESA|PRODUCTOS_RELEVANTES|PRODUCTO_RELEVANTE)\]/i.test(reply);
    const respectsInstructions = questionCount <= 1 && !hasBracketTags && reply.length > 0;

    const companyConfigured = params.companyDataText.trim().length > 0;

    // Company context can be plain-text rules or JSON-ish content depending on configuration.
    // Extract high-signal values when possible so validation doesn't depend on labels.
    const companyJson = (() => {
      const match = params.companyDataText.match(/\{[\s\S]*\}/);
      if (!match) {
        return null;
      }

      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    })();

    const companyName = this.parseCompanyNameFromCompanyDataText(params.companyDataText)
      || String((companyJson as any)?.company_name ?? (companyJson as any)?.companyName ?? (companyJson as any)?.name ?? '').trim();
    const companyAddress = String((companyJson as any)?.address ?? (companyJson as any)?.direccion ?? '').trim();
    const companyPhone = String((companyJson as any)?.phone ?? (companyJson as any)?.telefono ?? '').trim();
    const companyPhoneDigits = companyPhone.replace(/[^0-9]/g, '');

    const replyLower = reply.toLowerCase();
    const replyHasAnyTime = /\b\d{1,2}:\d{2}\b/.test(reply);
    const replyHasMaps = /google\.com\/maps|maps\.app|\bmaps\b/i.test(reply);
    const replyHasBankWords = /\bbanco\b|\bcuenta\b|transfer/i.test(reply);
    const replyHasAddressWords = /\bdireccion\b|\bdirecci[oó]n\b|\bubic/i.test(reply);
    const replyHasWhatsapp = /whatsapp/i.test(reply);
    const replyHasPhoneLike = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)\d{3}[\s-]?\d{4}/.test(reply);
    const replyDigits = reply.replace(/[^0-9]/g, '');

    const usesCompanyIfApplies =
      companyApplicable === null
        ? true
        : (!companyConfigured
          ? true
          : (
              companyApplicable === 'location'
                ? (Boolean(companyAddress) && replyLower.includes(companyAddress.toLowerCase())) || replyHasMaps || replyHasAddressWords
                : companyApplicable === 'hours'
                  ? replyHasAnyTime || /horario|abierto|cerrado|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo/i.test(reply)
                  : companyApplicable === 'payment'
                    ? replyHasBankWords || /\b\d{3,}\b/.test(replyLower)
                    : companyApplicable === 'contact'
                      ? replyHasWhatsapp || replyHasPhoneLike || (companyPhoneDigits.length > 0 && replyDigits.includes(companyPhoneDigits)) || (companyName.length > 0 && replyLower.includes(companyName.toLowerCase()))
                      : true
            ));

    const normalizedReply = this.normalizeTextForMatch(reply);
    const genericPatterns = [
      'claro te ayudo',
      'te ayudo con eso',
      'tenemos varias opciones',
      'tenemos opciones',
      'depende',
      'dime en que te puedo ayudar',
      'dime que necesitas',
      'listo te ayudo',
      'en que te ayudo',
      'que necesitas saber',
    ];
    const productKeywordPool = relevantPool
      .map((product) => [product.descripcionCorta, product.descripcionCompleta]
        .map((value) => (value ?? '').toString())
        .join(' '))
      .join(' ');
    const extractedProductTokens = (productKeywordPool || '')
      ? this.tokenizeNormalized(productKeywordPool, { minTokenLength: 5, maxTokens: 20 })
      : [];

    const usesProductsByKeywords = Boolean(normalizedReply)
      && extractedProductTokens.some((token) => token && normalizedReply.includes(token));
    const usesProductsExpanded = usesProducts || usesProductsByKeywords;

    const genericWithoutKnowledge =
      Boolean(normalizedReply)
      && !usesProductsExpanded
      && genericPatterns.some((pattern) => normalizedReply.includes(this.normalizeTextForMatch(pattern)));

    const severeFailures: string[] = [];
    const criticalFailures: string[] = [];
    const warnings: string[] = [];

    // Media attached: value can be carried by the media + short caption. Do not hard-block.
    if ((params.mediaCount ?? 0) > 0) {
      if (!respectsInstructions) {
        severeFailures.push('FALLA_GRAVE: respuesta_no_respeta_instrucciones_basicas');
      }
      if (!usesCompanyIfApplies) {
        severeFailures.push('FALLA_GRAVE: respuesta_no_usa_empresa_cuando_aplica');
      }

      return {
        ok: severeFailures.length === 0,
        severeFailures,
        criticalFailures,
        warnings,
        checks: {
          usesProducts: true,
          respectsInstructions,
          usesCompanyIfApplies,
          genericWithoutKnowledge: false,
          hasBenefit: true,
          hasFunction: true,
          hasNeedConnection: true,
          coherentWithProducts: true,
          salesFlowOk: true,
        },
      };
    }

    const functionHints = [
      'funciona',
      'sirve',
      'se usa',
      'se toma',
      'modo de uso',
      'toma',
      'tomarlo',
      'usar',
    ];
    const benefitHints = [
      'beneficio',
      'beneficios',
      'resultado',
      'resultados',
      'ayuda',
      'apoya',
      'mejora',
      'bienestar',
      'digest',
      'digestion',
      'energ',
    ];

    const hasFunction = Boolean(normalizedReply)
      && functionHints.some((hint) => normalizedReply.includes(this.normalizeTextForMatch(hint)));

    const hasBenefit = Boolean(normalizedReply)
      && (
        benefitHints.some((hint) => normalizedReply.includes(this.normalizeTextForMatch(hint)))
        || extractedProductTokens.some((token) => token && normalizedReply.includes(token))
      );

    const needs = this.inferNeedsFromNormalizedMessage(messageNormalized);

    const connectionPhrases = [
      'si lo que buscas',
      'para ti',
      'en tu caso',
      'segun lo que me dices',
      'ya sabes',
      'si te preocupa',
      'si te interesa',
      'lo importante es',
    ];
    const hasNeedConnection = this.hasNeedConnection({
      normalizedReply,
      questionCount,
      needs,
      connectionPhrases,
    });

    const replyMentionsPrice = this.replyMentionsPrice(reply, normalizedReply);
    const hasKnownPriceIfMentionsPrice = this.hasKnownPriceIfMentionsPrice({
      reply,
      normalizedReply,
      products: params.allProducts,
      replyMentionsPrice,
    });

    const configuredPhoneMatch = (params.companyDataText || '').match(/(?:^|\n)Telefono:\s*([^\n]+)/i);
    const configuredPhoneDigits = (configuredPhoneMatch?.[1] ?? '').replace(/[^0-9]/g, '');
    const replyPhoneMatch = reply.match(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)\d{3}[\s-]?\d{4}/);
    const replyPhoneDigits = (replyPhoneMatch?.[0] ?? '').replace(/[^0-9]/g, '');
    const phoneCoherent = !replyPhoneDigits
      ? true
      : (!configuredPhoneDigits ? true : replyPhoneDigits.endsWith(configuredPhoneDigits) || configuredPhoneDigits.endsWith(replyPhoneDigits));

    const coherentWithProducts = hasKnownPriceIfMentionsPrice && phoneCoherent;

    const closeOrSellPhrases = [
      'dame tu direccion',
      'dame tu dirección',
      'pasame tu ubicacion',
      'pásame tu ubicación',
      'te lo envio',
      'te lo envío',
      'vamos a pedirlo',
      'vamos a pedir',
      'te lo preparo',
      'te lo preparo ya',
      'para el pedido',
      'para ordenar',
    ];
    const triesToClose = Boolean(normalizedReply)
      && closeOrSellPhrases.some((phrase) => normalizedReply.includes(this.normalizeTextForMatch(phrase)));
    const salesFlowOk = !triesToClose || (hasBenefit && hasFunction);

    if (requiresProductValue && !usesProductsExpanded) {
      severeFailures.push('FALLA_GRAVE: respuesta_no_usa_productos');
    }

    if (requiresProductValue && !hasBenefit) {
      severeFailures.push('FALLA_GRAVE: respuesta_sin_beneficio_producto');
    }

    if (requiresProductValue && !hasFunction) {
      severeFailures.push('FALLA_GRAVE: respuesta_sin_funcion_o_uso');
    }

    if (requiresProductValue && !hasNeedConnection) {
      severeFailures.push('FALLA_GRAVE: respuesta_sin_conexion_con_necesidad');
    }

    if (!respectsInstructions) {
      severeFailures.push('FALLA_GRAVE: respuesta_no_respeta_instrucciones_basicas');
    }

    if (!usesCompanyIfApplies) {
      severeFailures.push('FALLA_GRAVE: respuesta_no_usa_empresa_cuando_aplica');
    }

    if (!coherentWithProducts) {
      criticalFailures.push('RESPUESTA_INCONSISTENTE_CON_CONOCIMIENTO');
    }

    if (!salesFlowOk) {
      severeFailures.push('FALLA_GRAVE: flujo_ventas_incorrecto_cierra_sin_explicar');
    }

    if (genericWithoutKnowledge) {
      criticalFailures.push('RESPUESTA_SIN_BASE_DE_CONOCIMIENTO');
    }

    if (reply.length > 0 && reply.length < 12 && params.allProducts.length > 0) {
      warnings.push('ADVERTENCIA: respuesta_demasiado_corta_posible_generica');
    }

    return {
      ok: severeFailures.length === 0 && criticalFailures.length === 0,
      severeFailures,
      criticalFailures,
      warnings,
      checks: {
        usesProducts: requiresProductValue ? usesProductsExpanded : true,
        respectsInstructions,
        usesCompanyIfApplies,
        genericWithoutKnowledge,
        hasBenefit: requiresProductValue ? hasBenefit : true,
        hasFunction: requiresProductValue ? hasFunction : true,
        hasNeedConnection: requiresProductValue ? hasNeedConnection : true,
        coherentWithProducts,
        salesFlowOk,
      },
    };
  }

  private getAuditSnapshotKey(contactId: string): string {
    return `audit:last:${contactId}`;
  }

  private async persistAuditSnapshot(contactId: string, snapshot: Record<string, unknown>): Promise<void> {
    if (!this.isAiAuditEnabled()) {
      return;
    }

    try {
      await this.redisService.set(this.getAuditSnapshotKey(contactId), snapshot, 60 * 30);
      const maybePush = (this.redisService as unknown as { pushToList?: (key: string, value: unknown) => Promise<void> }).pushToList;
      if (typeof maybePush === 'function') {
        await maybePush.call(this.redisService, `audit:events:${contactId}`, snapshot);
      }
    } catch {
      // Audit persistence must never break production replies.
    }
  }

  private buildQuickPriceReply(products: StructuredProduct[], relevantProducts: StructuredProduct[], message: string): string {
    const featured = relevantProducts[0] ?? products[0] ?? null;
    if (!featured) {
      return 'Claro. ¿De cuál producto quieres el precio?';
    }

    const price = this.valueToText(featured.precio) || this.valueToText(featured.precioMinimo);
    const title = featured.titulo.trim();

    const valueSnippet = this.buildProductValueMiniSnippet({
      product: featured,
      message,
    });

    if (!price) {
      return `${valueSnippet} Ahora mismo no tengo el precio configurado. ¿Quieres que te explique como se usa o resultados?`;
    }

    // Keep 1 question total.
    return `${valueSnippet} Precio: ${price}. ¿Prefieres que te explique como se usa o te ayudo a pedirlo?`;
  }

  private buildQuickBenefitsReply(product: StructuredProduct | null): string {
    if (!product?.titulo?.trim()) {
      return 'Perfecto. ¿De cuál producto quieres saber beneficios?';
    }

    const benefit = (product.descripcionCorta || product.descripcionCompleta || '').trim();
    const snippet = this.limitText(benefit.replace(/[?¿]/g, ''), 140);

    return snippet
      ? `${product.titulo.trim()}: ${snippet}. ¿Quieres que te diga el precio o como se usa?`
      : `${product.titulo.trim()}: ¿Quieres que te diga el precio o como se usa?`;
  }

  private buildQuickUsageReply(product: StructuredProduct | null): string {
    if (!product?.titulo?.trim()) {
      return 'Dale. ¿De cuál producto quieres saber como se usa?';
    }

    const details = (product.descripcionCompleta || product.descripcionCorta || '').trim();
    const snippet = this.limitText(details.replace(/[?¿]/g, ''), 140);

    return snippet
      ? `${product.titulo.trim()}: ${snippet}. ¿Quieres que te diga el precio también?`
      : `${product.titulo.trim()}: ¿Quieres que te diga el precio también?`;
  }

  private buildCompactKnowledgeContext(params: {
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>;
    botConfig: Awaited<ReturnType<BotConfigService['getConfig']>>;
    relevantProduct: StructuredProduct | null;
    companyDataText: string;
  }): string {
    const instructions = this.buildInstructionsKnowledgeBlock(params.config, params.botConfig);
    const productBlock = params.relevantProduct ? this.formatProductKnowledgeBlock(params.relevantProduct) : '';

    const sections: string[] = [];
    if (instructions.trim()) {
      sections.push('[INSTRUCCIONES]');
      sections.push(this.limitText(instructions.trim(), 900));
    }

    if (productBlock.trim()) {
      sections.push('[PRODUCTO_RELEVANTE]');
      sections.push(this.limitText(productBlock.trim(), 700));
    }

    if (params.companyDataText.trim()) {
      sections.push('[EMPRESA]');
      sections.push(this.limitText(params.companyDataText.trim(), 600));
    }

    return this.limitText(sections.join('\n\n').trim(), BotService.AI_CONTEXT_MAX_CHARS);
  }

  private buildCompactContextKnowledgeContext(params: {
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>;
    botConfig: Awaited<ReturnType<BotConfigService['getConfig']>>;
    relevantProduct: StructuredProduct | null;
    companyDataText: string;
  }): string {
    const instructions = this.buildInstructionsKnowledgeBlock(params.config, params.botConfig);
    const productBlock = params.relevantProduct ? this.formatProductKnowledgeBlock(params.relevantProduct) : '';

    const sections: string[] = [];
    if (instructions.trim()) {
      sections.push('[INSTRUCCIONES]');
      sections.push(this.limitText(instructions.trim(), 520));
    }

    if (productBlock.trim()) {
      sections.push('[PRODUCTOS]');
      sections.push(this.limitText(productBlock.trim(), 520));
    }

    if (params.companyDataText.trim()) {
      sections.push('[EMPRESA]');
      sections.push(this.limitText(params.companyDataText.trim(), 520));
    }

    return this.limitText(sections.join('\n\n').trim(), BotService.AI_CONTEXT_MAX_CHARS);
  }

  private pickProductSnippet(product: StructuredProduct | null): string {
    if (!product?.titulo?.trim()) {
      return '';
    }

    const rawDescription = (product.descripcionCorta || product.descripcionCompleta || '').trim();
    const cleaned = rawDescription.replace(/\s+/g, ' ').trim();
    const sentence = cleaned.split(/[.!?]\s+/)[0]?.trim() ?? '';
    const short = (sentence || cleaned).slice(0, 120).trim().replace(/[?¿]/g, '').trim();

    if (!short) {
      return product.titulo.trim();
    }

    return `${product.titulo.trim()}: ${short}`;
  }

  private inferNeedLabelFromMessage(message: string): string | null {
    const normalized = this.normalizeTextForMatch(message);
    if (!normalized) {
      return null;
    }

    if (normalized.includes('bajar de peso') || normalized.includes('rebajar') || normalized.includes('adelgaz')) {
      return 'bajar de peso';
    }

    if (normalized.includes('digest') || normalized.includes('digestion')) {
      return 'mejorar la digestion';
    }

    if (normalized.includes('bienestar')) {
      return 'sentirte mejor';
    }

    return null;
  }

  private buildProductValueMiniSnippet(params: {
    product: StructuredProduct | null;
    message: string;
  }): string {
    const title = params.product?.titulo?.trim() ?? '';
    if (!title) {
      return '';
    }

    const rawDescription = (params.product?.descripcionCorta || params.product?.descripcionCompleta || '').trim();
    const cleaned = rawDescription.replace(/\s+/g, ' ').trim().replace(/[?¿]/g, '');
    const firstSentence = cleaned.split(/[.!]\s+/)[0]?.trim() ?? '';
    const benefit = this.limitText(firstSentence || cleaned, 90);

    const need = this.inferNeedLabelFromMessage(params.message);
    const connection = need
      ? `Si lo que buscas es ${need}, te puede servir.`
      : 'Si lo que buscas es cómo se usa y qué resultados notar, te guío.';

    const benefitLine = benefit ? `${title}: ${benefit}.` : `${title}.`;
    const functionLine = benefit
      ? `Funciona como apoyo para ${benefit.toLowerCase().replace(/\.$/, '')}.`
      : 'Funciona como apoyo diario.';

    return [benefitLine, functionLine, connection]
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join(' ')
      .trim();
  }

  private buildSalesActiveFallbackReply(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>> | null,
    message: string,
    conversationMemory: ConversationMemoryState,
  ): string {
    const greetingOnly = this.isGreetingOnlyMessage(message);
    const intent = this.detectIntent(message);

    const products = config ? this.getProductsFromConfig(config) : [];
    const relevantProductsRaw = config ? this.filterRelevantProducts(products, message) : [];
    const relevantProducts = this.applySingleActiveProductAssumption(products, relevantProductsRaw);
    const featuredProduct = relevantProducts[0] ?? products[0] ?? null;
    const productSnippet = this.buildProductValueMiniSnippet({
      product: featuredProduct,
      message,
    });

    const closingQuestion = greetingOnly
      ? 'Que te interesa saber primero: precio, resultados o como se usa?'
      : this.buildNonRepeatingQuestion(message, intent, conversationMemory);

    const introOptions = greetingOnly
      ? ['Hola 👋', 'Hola, dime', 'Hey, cuentame']
      : ['Te ayudo de una vez', 'Listo, te ayudo rapido', 'Vamos a resolverlo rapido'];

    const intro = this.pickFirstUnsentMessage(introOptions, conversationMemory.sentMessages);

    const options = [
      [intro, productSnippet ? `Por ejemplo, ${productSnippet}.` : '', closingQuestion].filter(Boolean).join(' '),
      [intro, productSnippet ? `${productSnippet}.` : '', closingQuestion].filter(Boolean).join(' '),
      [intro, closingQuestion].filter(Boolean).join(' '),
    ]
      .map((value) => value.replace(/\s+/g, ' ').trim())
      .filter((value) => value.length > 0);

    return this.pickFirstUnsentMessage(options, conversationMemory.sentMessages);
  }

  private async buildFallbackResult(
    contactId: string,
    message: string,
  ): Promise<BotReplyResult> {
    const conversationMemory = await this.getConversationMemory(contactId, []);
    let config: Awaited<ReturnType<ClientConfigService['getConfig']>> | null = null;
    try {
      config = await this.clientConfigService.getConfig();
    } catch {
      config = null;
    }

    const fallbackReply = this.buildSalesActiveFallbackReply(config, message, conversationMemory);
    const intent = this.detectIntent(message);

    try {
      await this.memoryService.saveMessage({
        contactId,
        role: 'assistant',
        content: fallbackReply,
      });
      await this.saveConversationMemory(
        recordConversationDelivery(conversationMemory, {
          messageText: fallbackReply,
          lastMessages: [message, fallbackReply],
          lastIntent: intent,
          lastSentHadVideo: false,
          cooldownMediaUntil: null,
        }),
      );
    } catch {
      // Ignore fallback persistence failures.
    }

    const result = this.createResult(
      fallbackReply,
      'fallback',
      intent,
      this.buildFallbackDecisionState(contactId, message),
      false,
      [],
      'text',
      conversationMemory.lastMessages.length > 0,
    );

    console.log('RESPUESTA FINAL:', {
      text: result.reply,
      mediaIds: [],
      source: result.source,
    });
    console.log('ENVIADA:', {
      text: result.reply,
      mediaIds: [],
    });
    await this.persistMicroContext(contactId, result.decisionIntent, result.reply, 'text');
    return result;
  }

  private buildCombinedConversationContext(
    knowledgeContext: string,
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
    thinkingAnalysis?: ThinkingAnalysis,
  ): string {
    const conversationContext = this.buildConversationContext(memoryContext);
    const thinkingContext = thinkingAnalysis
      ? this.buildThinkingContext(thinkingAnalysis)
      : '';

    // Keep mandatory knowledge early (less truncation risk), then thinking, then memory.
    return [knowledgeContext.trim(), thinkingContext.trim(), conversationContext.trim()]
      .filter((section) => section.length > 0)
      .join('\n\n');
  }

  private analyzeAndThink(
    userMessage: string,
    state: {
      memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>;
      conversationMemory: ConversationMemoryState;
      decision: BotDecisionState;
      intent: BotIntent;
      hotLead: boolean;
    },
  ): ThinkingAnalysis {
    const normalizedMessage = this.normalizeTextForMatch(userMessage);
    const assistantHistory = state.memoryContext.messages.filter((item) => item.role === 'assistant');
    const userHistory = state.memoryContext.messages.filter((item) => item.role === 'user');
    const alreadyExplained = assistantHistory.some((item) =>
      /funciona|sirve|precio|se usa|beneficio|resultado|explico/i.test(item.content),
    ) || Boolean(state.memoryContext.summary.summary?.trim());
    const repetitionRisk =
      state.conversationMemory.sentMessages.length > 0 && (
        state.conversationMemory.lastMessages.some((item) => this.normalizeTextForMatch(item) === normalizedMessage)
        || this.hasShortBackAndForthLoop(userHistory)
      );

    const userState: ThinkingAnalysis['userState'] = state.hotLead
      ? 'listo'
      : state.decision.stage === 'interesado'
        ? 'interesado'
        : state.decision.stage === 'dudoso'
          ? 'interesado'
          : state.memoryContext.messages.length <= 2
            ? 'frio'
            : 'curioso';

    let nextBestAction: ThinkingAnalysis['nextBestAction'] = 'avanzar';
    let responseStrategy = 'responder natural y mover la conversacion.';

    const wantsExplanation =
      this.requiresDetailedResponse(userMessage)
      || this.requiresInstructionalWalkthrough(userMessage)
      || state.decision.intent === 'info';

    if (state.hotLead || state.decision.action === 'cerrar') {
      // Guardrail: never "close" or "sell direct" if we haven't explained value yet.
      if (!alreadyExplained) {
        nextBestAction = 'explicar';
        responseStrategy = 'primero explicar el producto (beneficio + como funciona/uso) y luego guiar a compra.';
      } else {
        nextBestAction = 'cerrar';
        responseStrategy = 'cerrar suave y llevar al siguiente paso de compra.';
      }
    } else if (repetitionRisk && alreadyExplained) {
      nextBestAction = 'avanzar';
      responseStrategy = 'no repetir, resumir brevemente y llevar a precio o siguiente paso.';
    } else if (alreadyExplained) {
      nextBestAction = 'resumir';
      responseStrategy = 'resumir lo esencial sin explicar otra vez y empujar la conversacion.';
    } else if (wantsExplanation || state.intent === 'duda' || state.decision.action === 'persuadir') {
      nextBestAction = 'explicar';
      responseStrategy = 'explicar claro, resolver la duda y cerrar con una pregunta util.';
    } else if (state.intent === 'interes' || state.intent === 'compra') {
      nextBestAction = 'avanzar';
      responseStrategy = 'ser directo, responder valor y mover a precio o compra.';
    } else {
      nextBestAction = 'preguntar';
      responseStrategy = 'responder corto y hacer una sola pregunta para avanzar sin caer en bucle.';
    }

    return {
      intent: state.decision.intent,
      userState,
      alreadyExplained,
      repetitionRisk,
      nextBestAction,
      responseStrategy,
    };
  }

  private hasShortBackAndForthLoop(userHistory: StoredMessage[]): boolean {
    const recentUserMessages = userHistory
      .slice(-3)
      .map((item) => this.normalizeTextForMatch(item.content))
      .filter((item) => item.length > 0);

    if (recentUserMessages.length < 2) {
      return false;
    }

    return new Set(recentUserMessages).size < recentUserMessages.length;
  }

  private buildThinkingContext(analysis: ThinkingAnalysis): string {
    return [
      '[THINKING_RESULT]',
      `intent: ${analysis.intent}`,
      `userState: ${analysis.userState}`,
      `alreadyExplained: ${analysis.alreadyExplained ? 'true' : 'false'}`,
      `repetitionRisk: ${analysis.repetitionRisk ? 'true' : 'false'}`,
      `nextBestAction: ${analysis.nextBestAction}`,
      `responseStrategy: ${analysis.responseStrategy}`,
      'Usa este análisis para decidir si conviene explicar, resumir, preguntar, avanzar o cerrar.',
      'Si ya se explicó lo suficiente, no expliques dos veces lo mismo.',
      'Si no hay valor nuevo, pregunta. Si hay interés, avanza a compra con naturalidad.',
    ].join('\n');
  }

  private async getRequiredKnowledgeContext(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
    botConfig: Awaited<ReturnType<BotConfigService['getConfig']>>,
    message: string,
    relevantProducts: StructuredProduct[],
  ): Promise<string> {
    const cached = await this.redisService.get<string>(BotService.KNOWLEDGE_CONTEXT_CACHE_KEY);
    const baseContext = cached?.trim() || (await this.buildAndCacheBaseKnowledgeContext(config, botConfig));
    const relevantProductsBlock = this.buildProductsKnowledgeBlock(relevantProducts);

    if (!relevantProductsBlock || !baseContext.includes('[PRODUCTOS]')) {
      return baseContext;
    }

    return this.appendRelevantProductsSection(baseContext, relevantProductsBlock);
  }

  private async buildAndCacheBaseKnowledgeContext(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
    botConfig: Awaited<ReturnType<BotConfigService['getConfig']>>,
  ): Promise<string> {
    const cached = await this.redisService.get<string>(BotService.KNOWLEDGE_CONTEXT_CACHE_KEY);
    if (cached?.trim()) {
      return cached.trim();
    }

    const instructionsBlock = this.buildInstructionsKnowledgeBlock(config, botConfig);
    const productsBlock = this.buildProductsKnowledgeBlock(this.getProductsFromConfig(config));
    const companyBlock = (await this.companyContextService.buildAgentContext()).trim();

    const sections: string[] = [
      '[INSTRUCCIONES]',
      instructionsBlock || 'Sin instrucciones configuradas. Usa el prompt base sin inventar datos ni romper el tono comercial.',
      '[PRODUCTOS]',
      productsBlock || 'Catalogo no configurado. No inventes productos ni beneficios.',
      '[EMPRESA]',
      companyBlock || 'Informacion de empresa no configurada. Si preguntan horario, ubicacion, pago o contacto, responde solo con lo que este disponible sin inventar.',
    ];

    const knowledgeContext = sections.join('\n\n');

    await this.redisService.set(BotService.KNOWLEDGE_CONTEXT_CACHE_KEY, knowledgeContext);
    return knowledgeContext;
  }

  private buildInstructionsKnowledgeBlock(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
    botConfig: Awaited<ReturnType<BotConfigService['getConfig']>>,
  ): string {
    const configurations = this.asRecord(config.configurations);
    const structuredInstructions = this.asRecord(configurations.instructions);
    const identity = this.asRecord(structuredInstructions.identity);
    const structuredRules = this.asStringList(structuredInstructions.rules);
    const salesPrompts = this.asRecord(structuredInstructions.salesPrompts);
    const prompts = this.asRecord(configurations.prompts);

    const primaryPrompt = this.pickFirstMeaningful([
      this.asString(config.promptBase),
      this.botConfigService.getFullPrompt(botConfig),
    ]);

    const parsedFromPrompt = primaryPrompt ? this.parseInstructionsPrompt(primaryPrompt) : {};

    const fallbackIdentity = this.joinInstructionBlocks([
      this.asString(identity.assistantName) ? `Nombre interno: ${this.asString(identity.assistantName)}` : '',
      this.asString(identity.role) ? `Rol: ${this.asString(identity.role)}` : '',
      this.asString(identity.tone) ? `Tono: ${this.asString(identity.tone)}` : '',
      this.asString(identity.personality) ? `Personalidad: ${this.asString(identity.personality)}` : '',
      this.asString(identity.responseStyle) ? `Estilo: ${this.asString(identity.responseStyle)}` : '',
      this.asString(identity.signature) ? `Firma: ${this.asString(identity.signature)}` : '',
    ]);

    const fallbackObjective = this.joinInstructionBlocks([
      this.asString(identity.objective),
    ]);

    const fallbackRules = this.joinInstructionBlocks([
      structuredRules.length > 0 ? structuredRules.map((rule) => `- ${rule}`).join('\n') : '',
      this.asString(identity.guardrails),
    ]);

    const fallbackSales = this.joinInstructionBlocks([
      this.asString(salesPrompts.opening) ? `Apertura: ${this.asString(salesPrompts.opening)}` : '',
      this.asString(salesPrompts.qualification) ? `Calificacion: ${this.asString(salesPrompts.qualification)}` : '',
      this.asString(salesPrompts.offer) ? `Oferta: ${this.asString(salesPrompts.offer)}` : '',
      this.asString(salesPrompts.objectionHandling) ? `Objeciones: ${this.asString(salesPrompts.objectionHandling)}` : '',
      this.asString(salesPrompts.closing) ? `Cierre: ${this.asString(salesPrompts.closing)}` : '',
      this.asString(salesPrompts.followUp) ? `Seguimiento: ${this.asString(salesPrompts.followUp)}` : '',
      this.asString(prompts.salesGuidelines),
      this.asString(prompts.objectionHandling),
      this.asString(prompts.closingPrompt),
      this.asString(prompts.supportPrompt),
    ]);

    const specialsFallback = {
      saludo: this.asString(prompts.greeting),
      despedida: '',
      respuestaCorta: '',
      respuestaLarga: '',
    };

    const normalized = this.normalizeInstructionsSections({
      identidad: this.pickFirstMeaningful([parsedFromPrompt.identidad, fallbackIdentity]),
      objetivo: this.pickFirstMeaningful([parsedFromPrompt.objetivo, fallbackObjective]),
      reglas: this.pickFirstMeaningful([parsedFromPrompt.reglas, fallbackRules]),
      ventas: this.pickFirstMeaningful([parsedFromPrompt.ventas, fallbackSales]),
      mediaRules: this.pickFirstMeaningful([parsedFromPrompt.mediaRules, '']),
      audioRules: this.pickFirstMeaningful([parsedFromPrompt.audioRules, '']),
      promptsEspeciales: {
        saludo: this.pickFirstMeaningful([
          parsedFromPrompt.promptsEspeciales?.saludo,
          specialsFallback.saludo,
        ]),
        despedida: this.pickFirstMeaningful([
          parsedFromPrompt.promptsEspeciales?.despedida,
          specialsFallback.despedida,
        ]),
        respuestaCorta: this.pickFirstMeaningful([
          parsedFromPrompt.promptsEspeciales?.respuestaCorta,
          specialsFallback.respuestaCorta,
        ]),
        respuestaLarga: this.pickFirstMeaningful([
          parsedFromPrompt.promptsEspeciales?.respuestaLarga,
          specialsFallback.respuestaLarga,
        ]),
      },
    });

    return this.renderInstructionsPrompt(normalized).trim();
  }

  private pickFirstMeaningful(values: Array<string | null | undefined>): string {
    for (const value of values) {
      const normalized = (value ?? '').trim();
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  private joinInstructionBlocks(values: Array<string | null | undefined>): string {
    const blocks = values
      .map((value) => (value ?? '').trim())
      .filter((value) => value.length > 0);

    return blocks.join('\n\n').trim();
  }

  private parseInstructionsPrompt(prompt: string): {
    identidad?: string;
    objetivo?: string;
    reglas?: string;
    ventas?: string;
    mediaRules?: string;
    audioRules?: string;
    promptsEspeciales?: {
      saludo?: string;
      despedida?: string;
      respuestaCorta?: string;
      respuestaLarga?: string;
    };
  } {
    const text = (prompt ?? '').replace(/\r\n/g, '\n').trim();
    if (!text) {
      return {};
    }

    const identidad = this.extractBracketSection(text, 'IDENTIDAD');
    const objetivo = this.extractBracketSection(text, 'OBJETIVO');
    const reglas = this.extractBracketSection(text, 'REGLAS');
    const ventas = this.extractBracketSection(text, 'VENTAS');
    const mediaRules = this.extractBracketSection(text, 'MEDIA_RULES');
    const audioRules = this.extractBracketSection(text, 'AUDIO_RULES');
    const promptsEspecialesBlock = this.extractBracketSection(text, 'PROMPTS_ESPECIALES');

    const promptsEspeciales = promptsEspecialesBlock
      ? {
          saludo: this.extractKeyedSection(promptsEspecialesBlock, 'SALUDO'),
          despedida: this.extractKeyedSection(promptsEspecialesBlock, 'DESPEDIDA'),
          respuestaCorta: this.extractKeyedSection(promptsEspecialesBlock, 'RESPUESTA_CORTA'),
          respuestaLarga: this.extractKeyedSection(promptsEspecialesBlock, 'RESPUESTA_LARGA'),
        }
      : undefined;

    return {
      identidad,
      objetivo,
      reglas,
      ventas,
      mediaRules,
      audioRules,
      promptsEspeciales,
    };
  }

  private extractBracketSection(text: string, sectionName: string): string {
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalized = (text ?? '').replace(/\r\n/g, '\n');
    const match = normalized.match(
      // Strict header match: [SECTION] must be alone on its line.
      new RegExp(`(^|\\n)\\[${escaped}\\][\\t ]*\\n([\\s\\S]*?)(?=\\n\\[[A-Z0-9_]+\\][\\t ]*\\n|$)`),
    );

    return (match?.[2] ?? '').trim();
  }

  private extractKeyedSection(text: string, key: string): string {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalized = (text ?? '').replace(/\r\n/g, '\n').trim();
    if (!normalized) {
      return '';
    }

    const match = normalized.match(
      new RegExp(`(^|\\n)${escaped}:\\s*([\\s\\S]*?)(?=\\n[A-Z0-9_]+:|$)`),
    );

    return (match?.[2] ?? '').trim();
  }

  private normalizeInstructionsSections(sections: {
    identidad: string;
    objetivo: string;
    reglas: string;
    ventas: string;
    mediaRules: string;
    audioRules: string;
    promptsEspeciales: {
      saludo: string;
      despedida: string;
      respuestaCorta: string;
      respuestaLarga: string;
    };
  }): {
    identidad: string;
    objetivo: string;
    reglas: string;
    ventas: string;
    mediaRules: string;
    audioRules: string;
    promptsEspeciales: {
      saludo: string;
      despedida: string;
      respuestaCorta: string;
      respuestaLarga: string;
    };
  } {
    const defaults = {
      identidad:
        'Eres un asistente de ventas por WhatsApp. Hablas como una persona real dominicana: directo, claro y natural. No suenas robotico.',
      objetivo:
        'Ayudar al cliente, responder dudas y guiar la conversacion hacia la compra sin presion agresiva.',
      reglas: [
        '- Usa SIEMPRE [INSTRUCCIONES] como comportamiento.',
        '- Usa SIEMPRE [PRODUCTOS] como fuente principal de datos (titulo, descripcion, precio, imagenes y videos).',
        '- Usa [EMPRESA] para ubicacion, horario, pago y contacto. Nunca inventes datos.',
        '- Si falta un dato, dilo claro y ofrece el siguiente paso (pregunta unica).',
        '- Responde humano, breve y util. No mas de una pregunta por respuesta.',
      ].join('\n'),
      ventas:
        'Cuando el cliente muestre interes, responde con beneficio + pregunta de cierre suave. Si dice "me interesa"/"precio"/"quiero", pasa a cerrar pidiendo nombre, direccion y telefono en un solo mensaje.',
      mediaRules: [
        '- Si hay imagenes o videos disponibles y ayudan a vender, priorizalos.',
        '- No digas que no hay media sin revisar URLs/IDs disponibles en [PRODUCTOS] o galeria.',
        '- No inventes IDs/URLs.',
      ].join('\n'),
      audioRules: [
        '- La decision de audio es solo de formato, no de contenido.',
        '- Si respondes en audio, el audio debe decir EXACTAMENTE lo mismo que el texto final (misma frase, mismo contenido).',
        '- No reescribas ni parafrasees para voz. Prohibido doble generacion de contenido.',
      ].join('\n'),
      promptsEspeciales: {
        saludo:
          'Hola 👋 Que tal? En que te puedo ayudar hoy?',
        despedida:
          'Perfecto, cualquier cosa me escribes y te ayudo. 🙌',
        respuestaCorta:
          'Responde directo, en 1-2 frases, y avanza con una sola pregunta si hace falta.',
        respuestaLarga:
          'Si el cliente pide detalles, explica completo y ordenado, sin sonar tecnico ni robotico, y cierra con un siguiente paso.',
      },
    };

    const identidad = (sections.identidad || defaults.identidad).trim();
    const objetivo = (sections.objetivo || defaults.objetivo).trim();

    const reglasMerged = this.dedupeNonEmptyLines(
      this.joinInstructionBlocks([sections.reglas, defaults.reglas]),
    );

    const ventas = (sections.ventas || defaults.ventas).trim();
    const mediaRules = this.dedupeNonEmptyLines(
      this.joinInstructionBlocks([sections.mediaRules, defaults.mediaRules]),
    );
    const audioRules = this.dedupeNonEmptyLines(
      this.joinInstructionBlocks([sections.audioRules, defaults.audioRules]),
    );

    const promptsEspeciales = {
      saludo: (sections.promptsEspeciales.saludo || defaults.promptsEspeciales.saludo).trim(),
      despedida: (sections.promptsEspeciales.despedida || defaults.promptsEspeciales.despedida).trim(),
      respuestaCorta: (sections.promptsEspeciales.respuestaCorta || defaults.promptsEspeciales.respuestaCorta).trim(),
      respuestaLarga: (sections.promptsEspeciales.respuestaLarga || defaults.promptsEspeciales.respuestaLarga).trim(),
    };

    return {
      identidad,
      objetivo,
      reglas: reglasMerged,
      ventas,
      mediaRules,
      audioRules,
      promptsEspeciales,
    };
  }

  private dedupeNonEmptyLines(text: string): string {
    const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n');
    const seen = new Set<string>();
    const out: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/g, '');
      const key = line.trim().toLowerCase();
      if (!key) {
        out.push('');
        continue;
      }

      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(line);
    }

    return out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private renderInstructionsPrompt(sections: {
    identidad: string;
    objetivo: string;
    reglas: string;
    ventas: string;
    mediaRules: string;
    audioRules: string;
    promptsEspeciales: {
      saludo: string;
      despedida: string;
      respuestaCorta: string;
      respuestaLarga: string;
    };
  }): string {
    const blocks: string[] = [];

    blocks.push('[IDENTIDAD]');
    blocks.push((sections.identidad ?? '').trim());

    blocks.push('[OBJETIVO]');
    blocks.push((sections.objetivo ?? '').trim());

    blocks.push('[REGLAS]');
    blocks.push((sections.reglas ?? '').trim());

    blocks.push('[VENTAS]');
    blocks.push((sections.ventas ?? '').trim());

    blocks.push('[PROMPTS_ESPECIALES]');
    blocks.push(
      [
        `SALUDO:\n${(sections.promptsEspeciales?.saludo ?? '').trim()}`.trim(),
        `DESPEDIDA:\n${(sections.promptsEspeciales?.despedida ?? '').trim()}`.trim(),
        `RESPUESTA_CORTA:\n${(sections.promptsEspeciales?.respuestaCorta ?? '').trim()}`.trim(),
        `RESPUESTA_LARGA:\n${(sections.promptsEspeciales?.respuestaLarga ?? '').trim()}`.trim(),
      ].join('\n\n'),
    );

    blocks.push('[MEDIA_RULES]');
    blocks.push((sections.mediaRules ?? '').trim());

    blocks.push('[AUDIO_RULES]');
    blocks.push((sections.audioRules ?? '').trim());

    return blocks
      .map((value) => (value ?? '').trim())
      .filter((value) => value.length > 0)
      .join('\n\n')
      .trim();
  }

  private buildProductsKnowledgeBlock(products: StructuredProduct[]): string {
    return products
      .map((item) => this.formatProductKnowledgeBlock(item))
      .filter((item): item is string => item.length > 0)
      .join('\n\n')
      .trim();
  }

  private getRelevantProducts(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
    message: string,
  ): StructuredProduct[] {
    return this.filterRelevantProducts(this.getProductsFromConfig(config), message);
  }

  private getProductsFromConfig(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
  ): StructuredProduct[] {
    const configurations = this.asRecord(config.configurations);
    const structuredInstructions = this.asRecord(configurations.instructions);
    const rawProducts = Array.isArray(structuredInstructions.products)
      ? structuredInstructions.products
      : [];

    return rawProducts
      .map((value) => this.normalizeProduct(value))
      .filter((product): product is StructuredProduct => Boolean(product && product.activo));
  }

  private filterRelevantProducts(values: StructuredProduct[], message: string): StructuredProduct[] {
    const normalizedMessage = this.normalizeTextForMatch(message);
    if (!normalizedMessage) {
      return [];
    }

    const terms = normalizedMessage
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3);

    if (terms.length === 0) {
      return [];
    }

    const matchedProducts = values.filter((value) => {
      const haystack = this.normalizeTextForMatch(
        [
          value.titulo,
          value.descripcionCorta,
          value.descripcionCompleta,
          this.valueToText(value.precio),
          this.valueToText(value.precioMinimo),
        ]
          .map((item) => item.trim())
          .join(' '),
      );

      return terms.some((term) => haystack.includes(term));
    });

    if (matchedProducts.length > 0) {
      return matchedProducts;
    }

    if (
      values.length === 1 &&
      this.isGenericPriceQuestion(normalizedMessage) &&
      (values[0]?.imagenes.length ?? 0) + (values[0]?.videos.length ?? 0) > 0
    ) {
      return values;
    }

    return [];
  }

  private applySingleActiveProductAssumption(
    allProducts: StructuredProduct[],
    relevantProducts: StructuredProduct[],
  ): StructuredProduct[] {
    // CRITICAL RULE: if there is only one active product, never ask "which product".
    // Treat it as relevant even when the message doesn't mention the product name.
    if (allProducts.length === 1 && relevantProducts.length === 0) {
      return [allProducts[0]];
    }

    return relevantProducts;
  }

  private isGenericPriceQuestion(message: string): boolean {
    return ['precio', 'precio?', 'cuanto cuesta', 'cuánto cuesta', 'cuanto vale', 'cuánto vale'].includes(message);
  }

  private appendRelevantProductsSection(baseContext: string, productsBlock: string): string {
    if (!productsBlock.trim()) {
      return baseContext;
    }

    const relevantSection = [
      '[PRODUCTOS_RELEVANTES]',
      productsBlock,
      'Usa primero estos productos relevantes para responder y vender. Si vas a enviar media, toma primero sus imagenes o videos.',
    ].join('\n\n');

    if (baseContext.includes('[PRODUCTOS_RELEVANTES]')) {
      return baseContext.replace(
        /\[PRODUCTOS_RELEVANTES\][\s\S]*?(?=\n\n\[EMPRESA\]|$)/,
        relevantSection,
      );
    }

    if (baseContext.includes('[EMPRESA]')) {
      return baseContext.replace(/\n\n\[EMPRESA\]/, `\n\n${relevantSection}\n\n[EMPRESA]`);
    }

    return `${baseContext}\n\n${relevantSection}`;
  }

  private normalizeTextForMatch(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  }

  private formatProductKnowledgeBlock(product: StructuredProduct): string {
    if (!product.titulo) {
      return '';
    }

    const lines = [
      product.titulo,
      this.formatKnowledgeField('ID', product.id),
      this.formatKnowledgeField('Descripcion corta', product.descripcionCorta),
      this.formatKnowledgeField('Descripcion completa', product.descripcionCompleta),
      this.formatKnowledgeField('Precio', this.valueToText(product.precio)),
      this.formatKnowledgeField('Precio minimo', this.valueToText(product.precioMinimo)),
      this.formatKnowledgeField('Imagenes', product.imagenes.join(', ')),
      this.formatKnowledgeField('Videos', product.videos.join(', ')),
      this.formatKnowledgeField('Activo', product.activo ? 'si' : 'no'),
    ].filter((line) => line.length > 0);

    return lines.join('\n');
  }

  private normalizeProduct(value: unknown): StructuredProduct | null {
    const product = this.asRecord(value);
    const titulo =
      this.asString(product.titulo) ||
      this.asString(product.title) ||
      this.asString(product.name);

    if (!titulo) {
      return null;
    }

    const descripcionCorta =
      this.asString(product.descripcion_corta) ||
      this.asString(product.descripcionCorta) ||
      this.asString(product.summary);
    const descripcionCompleta =
      this.asString(product.descripcion_completa) ||
      this.asString(product.descripcionCompleta) ||
      this.asString(product.description) ||
      [
        this.asString(product.benefits),
        this.asString(product.usage),
        this.asString(product.notes),
      ]
        .filter((item) => item.length > 0)
        .join(' ');

    return {
      id: this.asString(product.id) || titulo,
      titulo,
      descripcionCorta,
      descripcionCompleta,
      precio: this.readScalarValue(product.precio, product.price),
      precioMinimo: this.readScalarValue(product.precio_minimo, product.precioMinimo),
      imagenes: this.asStringList(product.imagenes),
      videos: this.asStringList(product.videos),
      activo: this.readBoolean(product.activo, product.active, true),
    };
  }

  private appendLabeledValue(sections: string[], label: string, value: unknown): void {
    const content = this.asString(value);
    if (!content) {
      return;
    }

    sections.push(`${label}:\n${content}`);
  }

  private formatKnowledgeField(label: string, value: unknown): string {
    const content = this.asString(value);
    return content ? `- ${label}: ${content}` : '';
  }

  private async getSentMediaState(contactId: string): Promise<SentMediaState> {
    const cachedSentMediaUrls = await this.redisService.get<string[]>(
      `${BotService.SENT_MEDIA_CACHE_KEY_PREFIX}${contactId}`,
    );
    if (Array.isArray(cachedSentMediaUrls) && cachedSentMediaUrls.length > 0) {
      return {
        sentMediaUrls: cachedSentMediaUrls.filter((url) => typeof url === 'string' && url.trim().length > 0),
      };
    }

    const currentState = await this.prisma.contactState.findUnique({
      where: { contactId },
    });
    const notes = this.asRecord(currentState?.notesJson);

    return {
      sentMediaUrls: this.asStringList(notes.sentMediaUrls),
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readScalarValue(...values: unknown[]): string | number | null {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return null;
  }

  private readBoolean(...values: unknown[]): boolean {
    for (const value of values) {
      if (typeof value === 'boolean') {
        return value;
      }
    }

    return true;
  }

  private valueToText(value: string | number | null): string {
    if (typeof value === 'number') {
      return value.toString();
    }

    return value?.trim() || '';
  }

  private asStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private async selectMedia(message: string, intent: BotIntent) {
    const queryCacheKey = `media_cache:query:${this.hashValue(this.normalizeTextForMatch(message))}`;
    const cached = await this.readRedisCache<MediaFile[]>(queryCacheKey);
    if (Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    const take = intent === 'catalogo' || this.isVisualRequest(message) ? 5 : 3;
    const media = await this.mediaService.getMediaByKeyword(message, take);
    await this.redisService.set(queryCacheKey, media, BotService.MEDIA_CACHE_TTL_SECONDS);
    return media;
  }

  private detectMediaIntent(message: string): MediaIntent {
    const normalized = this.normalizeTextForMatch(message);
    if (!normalized) {
      return null;
    }

    const wantsImage = ['foto', 'fotos', 'imagen', 'imagenes', 'ver'].some((keyword) => normalized.includes(keyword));
    const wantsVideo = ['video', 'videos'].some((keyword) => normalized.includes(keyword));
    const wantsMedia = ['muestra', 'muestrame', 'como es', 'cómo es'].some((keyword) => normalized.includes(keyword));

    if (wantsImage && wantsVideo) {
      return 'MEDIA';
    }

    if (wantsVideo) {
      return 'VIDEO';
    }

    if (wantsImage) {
      return 'IMAGEN';
    }

    if (wantsMedia) {
      return 'MEDIA';
    }

    return null;
  }

  private async selectProductMedia(
    products: StructuredProduct[],
    mediaIntent: MediaIntent,
    action: BotDecisionAction,
  ): Promise<MediaFile[]> {
    if (products.length === 0) {
      return [];
    }

    const cachedProducts = await Promise.all(products.map(async (product) => {
      const key = `media_cache:${product.id}`;
      const cached = await this.readRedisCache<MediaCacheEntry>(key);
      if (cached) {
        return {
          ...product,
          imagenes: cached.images,
          videos: cached.videos,
        };
      }

      await this.redisService.set(
        key,
        {
          images: product.imagenes,
          videos: product.videos,
          updatedAt: Date.now(),
        } satisfies MediaCacheEntry,
        BotService.MEDIA_CACHE_TTL_SECONDS,
      );

      return product;
    }));

    if (mediaIntent === 'VIDEO') {
      return this.mapProductMedia(cachedProducts, 'video', 1);
    }

    if (mediaIntent === 'IMAGEN') {
      return this.mapProductMedia(cachedProducts, 'image', 3);
    }

    if (mediaIntent === 'MEDIA') {
      const images = this.mapProductMedia(cachedProducts, 'image', 3);
      return images.length > 0 ? images : this.mapProductMedia(cachedProducts, 'video', 1);
    }

    if (
      action === 'cerrar' ||
      action === 'responder_precio_con_valor' ||
      action === 'persuadir' ||
      action === 'guiar'
    ) {
      return this.mapProductMedia(cachedProducts, 'image', 1);
    }

    return [];
  }

  private mapProductMedia(
    products: StructuredProduct[],
    fileType: 'image' | 'video',
    take: number,
  ): MediaFile[] {
    const urls = products.flatMap((product) => {
      const mediaUrls = fileType === 'image' ? product.imagenes : product.videos;
      return mediaUrls.map((url) => ({ product, url }));
    });

    return urls.slice(0, take).map(({ product, url }, index) => ({
      id: -1 - index,
      title: product.titulo,
      description: product.descripcionCorta || product.descripcionCompleta || null,
      fileUrl: url,
      fileType,
      createdAt: this.productMediaTimestamp,
    }));
  }

  private limitOutgoingMediaFiles(
    mediaFiles: MediaFile[],
    mediaIntent: MediaIntent,
    sentMediaState: SentMediaState,
  ): MediaFile[] {
    const unseenMediaFiles = mediaFiles.filter(
      (file) => !sentMediaState.sentMediaUrls.includes(file.fileUrl),
    );
    const sourceFiles = unseenMediaFiles.length > 0 ? unseenMediaFiles : mediaFiles;

    if (mediaIntent === 'VIDEO') {
      return sourceFiles.filter((file) => file.fileType === 'video').slice(0, 1);
    }

    if (mediaIntent === 'IMAGEN' || mediaIntent === 'MEDIA') {
      return sourceFiles.filter((file) => file.fileType === 'image').slice(0, 2);
    }

    const images = sourceFiles.filter((file) => file.fileType === 'image').slice(0, 2);
    if (images.length > 0) {
      return images;
    }

    return sourceFiles.filter((file) => file.fileType === 'video').slice(0, 1);
  }

  private buildFastLaneReply(params: {
    message: string;
    intent: BotIntent;
    hotLead: boolean;
    mediaFiles: Awaited<ReturnType<BotService['getMediaByKeyword']>>;
    preferredReplyType: BotReplyResult['replyType'];
    responseStyle: AssistantResponseStyle;
    decision: BotDecisionState;
    usedMemory: boolean;
  }): BotReplyResult | null {
    if (
      this.requiresDetailedResponse(params.message) ||
      this.requiresSpecificDirectAnswer(params.message, params.intent)
    ) {
      return null;
    }

    if (params.mediaFiles.length > 0) {
      const galleryReply = params.intent === 'catalogo'
        ? 'Claro 👍 mira el catálogo aquí.'
        : 'Claro 👌 mira esta referencia.';

      return this.createResult(
        galleryReply,
        'galeria',
        params.intent,
        params.decision,
        false,
        params.mediaFiles,
        params.preferredReplyType,
        params.usedMemory,
      );
    }

    return null;
  }

  private createResult(
    reply: string,
    source: BotReplyResult['source'],
    intent: BotIntent,
    decision: BotDecisionState,
    hotLead: boolean,
    mediaFiles: Awaited<ReturnType<BotService['getMediaByKeyword']>>,
    replyType: BotReplyResult['replyType'],
    usedMemory: boolean,
    cached = false,
  ): BotReplyResult {
    return {
      reply,
      replyType,
      mediaFiles,
      intent,
      decisionIntent: decision.intent,
      stage: decision.stage,
      action: decision.action,
      purchaseIntentScore: decision.purchaseIntentScore,
      hotLead,
      cached,
      usedGallery: mediaFiles.length > 0,
      usedMemory,
      source,
    };
  }

  private getIntentCacheKey(contactId: string): string {
    return `intent:${contactId}`;
  }

  private getGreetingKey(contactId: string): string {
    return `greeted:${contactId}:${this.getBusinessDayKey()}`;
  }

  private getConversationEndKey(contactId: string): string {
    return `conversation_end:${contactId}`;
  }

  private getStateCacheKey(contactId: string): string {
    return `state:${contactId}`;
  }

  private getAnalysisCacheKey(contactId: string): string {
    return `analysis:${contactId}`;
  }

  private getNextBestActionCacheKey(contactId: string): string {
    return `nba:${contactId}`;
  }

  private getResponseCacheKey(hash: string): string {
    return `response_cache:${hash}`;
  }

  private getLastIntentKey(contactId: string): string {
    return `lastIntent:${contactId}`;
  }

  private getLastQuestionKey(contactId: string): string {
    return `lastQuestion:${contactId}`;
  }

  private getLastMessageTypeKey(contactId: string): string {
    return `lastMessageType:${contactId}`;
  }

  private buildResponseCacheHash(
    message: string,
    intent: BotDecisionIntent,
    stage: ContactStage,
  ): string {
    return this.hashValue(`${this.normalizeTextForMatch(message)}|${intent}|${stage}`);
  }

  private hashValue(value: string): string {
    return createHash('sha1').update(value).digest('hex');
  }

  private async readRedisCache<T>(key: string): Promise<T | null> {
    const value = await this.redisService.get<T>(key);
    console.log(value === null ? 'REDIS MISS:' : 'REDIS HIT:', key);
    return value;
  }

  private async getCachedCompanyRules(): Promise<Awaited<ReturnType<CompanyContextService['getContext']>>> {
    const cached = await this.readRedisCache<Awaited<ReturnType<CompanyContextService['getContext']>>>(
      BotService.COMPANY_RULES_CACHE_KEY,
    );
    if (cached) {
      return cached;
    }

    const companyData = await this.companyContextService.getContext();
    await this.redisService.set(
      BotService.COMPANY_RULES_CACHE_KEY,
      companyData,
      BotService.STATE_CACHE_TTL_SECONDS,
    );
    return companyData;
  }

  private areMessagesSimilar(left: string, right: string): boolean {
    const normalizedLeft = this.normalizeTextForMatch(left);
    const normalizedRight = this.normalizeTextForMatch(right);

    if (!normalizedLeft || !normalizedRight) {
      return false;
    }

    return normalizedLeft === normalizedRight
      || normalizedLeft.includes(normalizedRight)
      || normalizedRight.includes(normalizedLeft);
  }

  private async getCachedResponse(
    key: string,
    conversationMemory: ConversationMemoryState,
  ): Promise<ResponseCacheEntry | null> {
    const cached = await this.readRedisCache<ResponseCacheEntry>(key);
    if (!cached) {
      return null;
    }

    if (conversationMemory.sentMessages.includes(cached.reply)) {
      return null;
    }

    return cached;
  }

  private async cacheResponseIfEligible(
    key: string,
    result: BotReplyResult,
    conversationMemory: ConversationMemoryState,
  ): Promise<void> {
    if (result.mediaFiles.length > 0 || result.source === 'fallback') {
      return;
    }

    if (conversationMemory.sentMessages.includes(result.reply)) {
      return;
    }

    await this.redisService.set(
      key,
      {
        reply: result.reply,
        replyType: result.replyType,
        intent: result.intent,
        decisionIntent: result.decisionIntent,
        stage: result.stage,
        action: result.action,
        purchaseIntentScore: result.purchaseIntentScore,
        hotLead: result.hotLead,
        source: result.source,
        updatedAt: Date.now(),
      } satisfies ResponseCacheEntry,
      BotService.RESPONSE_CACHE_TTL_SECONDS,
    );
  }

  private resolvePreferredReplyType(params: {
    message: string;
    reply: string;
    intent: BotIntent;
    action: BotDecisionAction;
    metadata?: {
      messageType?: 'text' | 'audio' | 'image';
      transcript?: string | null;
    };
  }): BotReplyResult['replyType'] {
    const incoming = this.analyzeIncomingMessage(params.message, params.metadata);
    if (this.shouldUseTextReply(params.message, params.intent, params.action, incoming)) {
      return 'text';
    }

    const modalityIntent = this.detectReplyModalityIntent(
      params.message,
      params.intent,
      params.action,
    );

    if (
      modalityIntent === 'precio' ||
      modalityIntent === 'confirmacion' ||
      modalityIntent === 'compra' ||
      modalityIntent === 'cierre'
    ) {
      return 'text';
    }

    if (this.shouldUseAudioReply(params.message, params.reply, params.action, incoming)) {
      return 'audio';
    }

    return 'text';
  }

  private detectReplyModalityIntent(
    message: string,
    intent: BotIntent,
    action: BotDecisionAction,
  ): 'precio' | 'confirmacion' | 'compra' | 'cierre' | 'explicacion' | 'general' {
    const normalized = this.normalizeTextForMatch(message);

    if (!normalized) {
      return 'general';
    }

    if (action === 'cerrar' || intent === 'cierre') {
      return 'cierre';
    }

    if (['precio', 'cuanto', 'cuánto', 'vale'].some((keyword) => normalized.includes(keyword))) {
      return 'precio';
    }

    if (['ok', 'dale', 'perfecto', 'listo'].includes(normalized)) {
      return 'confirmacion';
    }

    if (
      ['como funciona', 'cómo funciona', 'explicame', 'explícame', 'que es', 'qué es']
        .some((keyword) => normalized.includes(keyword))
    ) {
      return 'explicacion';
    }

    if (
      ['quiero comprar', 'lo quiero', 'enviamelo', 'enviamelo']
        .some((keyword) => normalized.includes(keyword))
    ) {
      return 'compra';
    }

    return 'general';
  }

  private analyzeIncomingMessage(
    message: string,
    metadata?: {
      messageType?: 'text' | 'audio' | 'image';
      transcript?: string | null;
    },
  ): {
    messageType: 'text' | 'audio' | 'image';
    messageLength: 'corto' | 'medio' | 'largo';
  } {
    const messageType = metadata?.messageType === 'audio' || metadata?.messageType === 'image'
      ? metadata.messageType
      : 'text';
    const normalizedTranscript = (metadata?.transcript ?? message).trim();
    const size = normalizedTranscript.length;

    if (messageType === 'audio') {
      if (size > BotService.LONG_AUDIO_TRANSCRIPT_MIN_CHARS) {
        return { messageType, messageLength: 'largo' };
      }

      if (size >= BotService.SHORT_TEXT_MESSAGE_MAX_CHARS) {
        return { messageType, messageLength: 'medio' };
      }

      return { messageType, messageLength: 'corto' };
    }

    if (size < BotService.SHORT_TEXT_MESSAGE_MAX_CHARS) {
      return { messageType, messageLength: 'corto' };
    }

    if (size >= BotService.LONG_REPLY_MIN_CHARS) {
      return { messageType, messageLength: 'largo' };
    }

    return { messageType, messageLength: 'medio' };
  }

  private shouldUseTextReply(
    message: string,
    intent: BotIntent,
    action: BotDecisionAction,
    incoming: { messageType: 'text' | 'audio' | 'image'; messageLength: 'corto' | 'medio' | 'largo' },
  ): boolean {
    const normalized = this.normalizeTextForMatch(message);

    if (!normalized) {
      return true;
    }

    if (action === 'cerrar' || intent === 'cierre') {
      return true;
    }

    if (this.requiresSpecificDirectAnswer(message, intent)) {
      return true;
    }

    if (this.isSimpleConfirmation(normalized) || this.isGreetingMessage(normalized)) {
      return true;
    }

    return incoming.messageType === 'text' && incoming.messageLength === 'corto' && !this.requiresDetailedResponse(message);
  }

  private shouldUseAudioReply(
    message: string,
    reply: string,
    action: BotDecisionAction,
    incoming: { messageType: 'text' | 'audio' | 'image'; messageLength: 'corto' | 'medio' | 'largo' },
  ): boolean {
    const explicitVoicePreference = this.prefersVoiceReply(message);
    const detailedRequest = this.requiresDetailedResponse(message);
    const instructionRequest = this.requiresInstructionalWalkthrough(message);
    const emotionalSalesReply = this.isEmotionalSalesReply(reply, action);
    const longOrDetailedReply = this.isLongOrDetailedReply(reply);
    const voiceSuitableReply = longOrDetailedReply || this.isVoiceSuitableReply(reply);

    if (!voiceSuitableReply && !emotionalSalesReply) {
      return false;
    }

    if (incoming.messageType === 'audio' && incoming.messageLength !== 'corto') {
      if (action === 'persuadir' || detailedRequest || instructionRequest || explicitVoicePreference) {
        return true;
      }
    }

    if (incoming.messageType === 'text' && incoming.messageLength === 'largo') {
      return detailedRequest || instructionRequest || emotionalSalesReply || explicitVoicePreference;
    }

    if (explicitVoicePreference && (detailedRequest || instructionRequest || voiceSuitableReply)) {
      return true;
    }

    if (action === 'persuadir' && (voiceSuitableReply || emotionalSalesReply)) {
      return true;
    }

    return detailedRequest || instructionRequest;
  }

  private isVoiceSuitableReply(reply: string): boolean {
    const normalized = reply.trim();
    if (!normalized) {
      return false;
    }

    const words = normalized.split(/\s+/).filter((word) => word.length > 0);
    if (words.length >= 18) {
      return true;
    }

    return normalized.length >= 95;
  }

  private requiresInstructionalWalkthrough(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'como se usa',
      'cómo se usa',
      'como lo uso',
      'cómo lo uso',
      'como tomarlo',
      'cómo tomarlo',
      'como me lo tomo',
      'cómo me lo tomo',
      'paso por paso',
      'pasos',
      'instrucciones',
    ].some((keyword) => normalized.includes(keyword));
  }

  private isEmotionalSalesReply(reply: string, action: BotDecisionAction): boolean {
    if (action !== 'persuadir') {
      return false;
    }

    const normalized = reply.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'te explico',
      'te puede ayudar',
      'vas a sentir',
      'vas a notar',
      'te va a ayudar',
      'lo importante es',
      'mira',
    ].some((keyword) => normalized.includes(keyword));
  }

  private isSimpleConfirmation(message: string): boolean {
    return [
      'ok',
      'oka',
      'okey',
      'si',
      'sí',
      'dale',
      'perfecto',
      'listo',
      'gracias',
      'precio',
      'tienes',
      'hay',
    ].includes(message);
  }

  private isGreetingMessage(message: string): boolean {
    return ['hola', 'hola!', 'buenas', 'buenos dias', 'buenos dias!', 'buenas tardes', 'buenas noches'].includes(message);
  }

  private async getGreetingOutcome(
    contactId: string,
    message: string,
  ): Promise<'none' | 'first'> {
    if (!this.isGreetingOnlyMessage(message)) {
      return 'none';
    }

    if (await this.readRedisCache<boolean>(this.getConversationEndKey(contactId))) {
      return 'none';
    }

    // Only greet if there is NO prior interaction (first message ever).
    try {
      const memoryContext = await this.memoryService.getConversationContext(contactId, 1);
      const hasAnyMessages = (memoryContext.messages?.length ?? 0) > 0;
      const hasAnySummary = Boolean(memoryContext.summary?.summary?.trim());
      const clientStatus = (memoryContext.clientMemory?.status ?? '').toString().trim().toLowerCase();
      const hasKnownClient = clientStatus.length > 0 && clientStatus !== 'nuevo';

      if (hasAnyMessages || hasAnySummary || hasKnownClient) {
        return 'none';
      }
    } catch {
      // If we can't confirm newness safely, avoid greeting shortcut.
      return 'none';
    }

    const greetingKey = this.getGreetingKey(contactId);

    try {
      const acquired = await this.redisService.setIfAbsent(
        greetingKey,
        true,
        BotService.GREETING_DAY_KEY_TTL_SECONDS,
      );
      return acquired ? 'first' : 'none';
    } catch {
      const alreadyGreeted = (await this.readRedisCache<boolean>(greetingKey)) === true;
      if (alreadyGreeted) {
        return 'none';
      }

      await this.redisService.set(
        greetingKey,
        true,
        BotService.GREETING_DAY_KEY_TTL_SECONDS,
      );
      return 'first';
    }
  }

  private isGreetingOnlyMessage(message: string): boolean {
    const normalized = this.normalizeTextForMatch(message);
    if (!normalized) {
      return false;
    }

    return [
      'hola',
      'buenas',
      'klk',
      'hey',
      'saludos',
      'buenas tardes',
      'buenos dias',
      'buenas noches',
      'hola buenas',
    ].includes(normalized);
  }

  private buildGreetingReply(
    contactId: string,
    conversationMemory: ConversationMemoryState,
    context?: {
      companyName: string;
      productSnippet: string;
    },
  ): string {
    const companyName = context?.companyName?.trim() ?? '';
    const productSnippet = context?.productSnippet?.trim() ?? '';
    const suffixParts = [
      companyName ? `Soy de ${companyName}.` : '',
      productSnippet ? productSnippet : '',
    ].filter((value) => value.length > 0);
    const suffix = suffixParts.length > 0 ? ` ${suffixParts.join(' ')}` : '';

    const variants = [
      `Hola 👋 que tal, bienvenido. Dime en que te puedo ayudar.${suffix}`,
      `Hey 🙌 como estas, dime que te gustaria saber.${suffix}`,
      `Hola bro 🔥 bienvenido, aqui te ayudo con lo que necesites.${suffix}`,
      `Saludos 👋 tranquilo, dime en que andas y te ayudo.${suffix}`,
    ];
    const offset = parseInt(this.hashValue(contactId).slice(0, 2), 16) % variants.length;
    const orderedVariants = variants.slice(offset).concat(variants.slice(0, offset));

    return this.pickFirstUnsentMessage(orderedVariants, conversationMemory.sentMessages);
  }

  private buildGreetingNudgeReply(
    contactId: string,
    conversationMemory: ConversationMemoryState,
  ): string {
    const variants = [
      'Dime, en que te puedo ayudar?',
      'Dale, que necesitas saber?',
      'Perfecto, que te gustaria saber o comprar?',
      'Cuéntame, que buscas y te ayudo.',
    ];

    const offset = parseInt(this.hashValue(contactId).slice(0, 2), 16) % variants.length;
    const orderedVariants = variants.slice(offset).concat(variants.slice(0, offset));

    return this.pickFirstUnsentMessage(orderedVariants, conversationMemory.sentMessages);
  }

  private getBusinessDayKey(now = new Date()): string {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santo_Domingo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);
    } catch {
      return now.toISOString().slice(0, 10);
    }
  }

  private buildGreetingDecision(message: string): BotDecisionState {
    const normalized = this.normalizeTextForMatch(message);

    return {
      intent: 'otro',
      classificationSource: 'rules',
      stage: 'curioso',
      action: 'guiar',
      purchaseIntentScore: 0,
      currentIntent: 'greeting',
      summaryText: 'Greeting shortcut handled before thinking.',
      keyFacts: {
        greetingHandled: true,
      },
      lastMessageId: `greeting:${this.hashValue(normalized || 'empty')}`,
    };
  }

  private shouldMarkConversationAsEnded(message: string): boolean {
    const normalized = this.normalizeTextForMatch(message);
    if (!normalized || this.shouldResumeClosedConversation(message)) {
      return false;
    }

    return [
      'te aviso',
      'yo te aviso',
      'manana sera',
      'luego',
      'despues hablamos',
      'mas tarde',
      'lo dejamos asi',
      'dejalo asi',
      'ok gracias',
      'perfecto gracias',
      'listo gracias',
    ].some((keyword) => normalized.includes(keyword));
  }

  private shouldResumeClosedConversation(message: string): boolean {
    const normalized = this.normalizeTextForMatch(message);
    if (!normalized) {
      return false;
    }

    const intent = this.detectIntent(message);
    if (intent === 'interes' || intent === 'compra' || intent === 'catalogo' || intent === 'hot') {
      return true;
    }

    return [
      'precio',
      'cuanto',
      'vale',
      'quiero',
      'me interesa',
      'como compro',
      'como pido',
      'comprar',
      'pedido',
      'ordenar',
      'catalogo',
      'catalog',
      'mandame',
      'enviame',
      'enviamelo',
      'foto',
      'video',
      'ubicacion',
      'direccion',
      'pago',
      'cuenta',
      'disponible',
    ].some((keyword) => normalized.includes(keyword));
  }

  private buildConversationEndedReply(
    conversationMemory: ConversationMemoryState,
    closureDetected: boolean,
    productSnippet?: string,
  ): string {
    const options = closureDetected
      ? [
          'Perfecto, lo dejamos hasta ahi por ahora. Cuando quieras retomarlo, me escribes.',
          'Dale, lo dejamos asi por ahora. Aqui sigo cuando quieras retomarlo.',
          'Todo bien, lo dejamos por ahora. Aqui estare cuando quieras volver a eso.',
        ]
      : [
          'Claro, aqui sigo cuando quieras retomarlo.',
          'Todo bien, lo dejamos por ahora.',
          'Perfecto, aqui estare cuando quieras volver a eso.',
        ];

    const suffix = (productSnippet ?? '').trim();
    const withContext = suffix
      ? options.map((value) => `${value} ${suffix}`.replace(/\s+/g, ' ').trim())
      : options;

    return this.pickFirstUnsentMessage(withContext, conversationMemory.sentMessages);
  }

  private buildConversationEndedDecision(message: string): BotDecisionState {
    const normalized = this.normalizeTextForMatch(message);

    return {
      intent: 'no_interesado',
      classificationSource: 'rules',
      stage: 'curioso',
      action: 'cerrar',
      purchaseIntentScore: 0,
      currentIntent: 'conversation_end',
      summaryText: 'Client ended the conversation for now.',
      keyFacts: {
        conversationEnded: true,
      },
      lastMessageId: `conversation_end:${this.hashValue(normalized || 'empty')}`,
    };
  }

  private async resolveMicroIntentResult(params: {
    contactId: string;
    message: string;
    conversationMemory: ConversationMemoryState;
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>;
    usedMemory: boolean;
  }): Promise<MicroIntentResolution | null> {
    const microIntent = this.detectMicroIntent(params.message);
    if (!microIntent) {
      return null;
    }

    const lastIntent =
      (await this.readRedisCache<string>(this.getLastIntentKey(params.contactId)))
      ?? params.conversationMemory.lastIntent
      ?? null;
    const lastQuestion =
      (await this.readRedisCache<string>(this.getLastQuestionKey(params.contactId)))
      ?? this.findLatestAssistantQuestion(params.memoryContext.messages)
      ?? null;
    const hasPriorContext = Boolean((lastIntent ?? '').trim() || (lastQuestion ?? '').trim());
    if (!hasPriorContext && microIntent !== 'status') {
      return null;
    }

    const salesActive = hasPriorContext
      ? this.isSalesContextActive(lastIntent, lastQuestion)
      : false;
    const coldConversation = !salesActive && !params.usedMemory;

    if (microIntent === 'soft' && !salesActive && !lastQuestion) {
      return null;
    }

    if (microIntent === 'thanks' && !salesActive && !coldConversation) {
      return null;
    }

    const reply = this.buildMicroIntentReply(
      microIntent,
      salesActive,
      coldConversation,
      params.conversationMemory,
    );
    const decision = this.buildMicroIntentDecision(
      params.contactId,
      params.message,
      microIntent,
      salesActive,
    );

    return {
      reply,
      intent: this.mapDecisionIntentToBotIntent(decision.intent, params.message),
      decision,
    };
  }

  private detectMicroIntent(message: string): MicroIntentKind | null {
    const normalized = this.normalizeTextForMatch(message);
    if (!normalized) {
      return null;
    }

    const words = normalized.split(' ').filter((word) => word.length > 0);
    if (words.length === 0) {
      return null;
    }

    if (words.length <= 6) {
      const statusTail = '(?:\\s+(?:y|e)\\s+(?:tu|usted|ustedes))?';
      const statusThanks = '(?:\\s+gracias)?';
      const statusCore = '(?:bien|nitido|heavy)';
      const statusPrefix = '(?:todo|to|toy|tamo|ta)';
      const statusPattern = new RegExp(
        `^(?:${statusCore}|${statusPrefix}\\s+${statusCore})${statusThanks}${statusTail}$`,
      );

      if (statusPattern.test(normalized)) {
        return 'status';
      }
    }

    if (words.length > 3) {
      return null;
    }

    if (['si', 'sí', 'claro', 'de una'].includes(normalized)) {
      return 'yes';
    }

    if (['no', 'nop', 'negativo'].includes(normalized)) {
      return 'no';
    }

    if (['ok', 'oka', 'okey', 'dale', 'dale pues'].includes(normalized)) {
      return 'soft';
    }

    if (['gracias', 'muchas gracias', 'thanks'].includes(normalized)) {
      return 'thanks';
    }

    return null;
  }

  private buildMicroIntentReply(
    microIntent: MicroIntentKind,
    salesActive: boolean,
    coldConversation: boolean,
    conversationMemory: ConversationMemoryState,
  ): string {
    if (microIntent === 'status') {
      return this.pickFirstUnsentMessage(
        salesActive
          ? [
              'Que bueno 🙌 entonces dime, ¿quieres precio, como se usa o como pedirlo?'
            ]
          : [
              'Que bueno 🙌 dime, ¿en que te puedo ayudar hoy?'
            ],
        conversationMemory.sentMessages,
      );
    }

    if (microIntent === 'yes') {
      return this.pickFirstUnsentMessage(
        salesActive
          ? [
              'Perfecto 👍 ¿te lo preparo para hoy?',
              'Buenisimo 👍 ¿quieres que te lo deje listo de una vez?',
              'Dale 👍 ¿te organizo el pedido para hoy?',
            ]
          : [
              'Perfecto 👍 ¿quieres que te explique precio, uso o como pedirlo?',
              'Buenisimo 👍 dime si prefieres precio, resultados o como se usa.',
            ],
        conversationMemory.sentMessages,
      );
    }

    if (microIntent === 'no') {
      return this.pickFirstUnsentMessage([
        'Tranquilo 👍 dime, ¿que fue lo que no te convencio?',
        'Todo bien 👍 ¿que parte te genero duda, el precio, el uso o si funciona?',
        'No hay problema 👍 dime que te freno y te lo aclaro sin rodeos.',
      ], conversationMemory.sentMessages);
    }

    if (microIntent === 'soft') {
      return this.pickFirstUnsentMessage(
        coldConversation
          ? [
              'Oye, algo importante: esto te puede ayudar bastante y se usa super facil. ¿quieres que te explique rapido?',
              'Dale 🔥 esto puede darte una buena ayuda si lo haces bien. ¿quieres que te oriente rapido?',
            ]
          : [
              'Dale 🔥 eso te puede ayudar bastante... ¿quieres que te prepare uno?',
              'Buenisimo 🙌 si quieres, te lo dejo listo y te explico como usarlo.',
            ],
        conversationMemory.sentMessages,
      );
    }

    return this.pickFirstUnsentMessage(
      coldConversation
        ? [
            'Gracias a ti 🙌 oye, esto no es como otras pastillas... ¿quieres que te explique rapido por que?',
            'Gracias a ti 🙌 antes de irte, esto puede ayudarte bastante si quieres bajar sin complicarte.',
          ]
        : [
            'Gracias a ti 🙌 oye, antes de irte... esto te puede ayudar bastante para arrancar bien. ¿quieres que te prepare uno?',
            'Gracias a ti 🙌 si quieres, te digo rapido como sacarle mejor provecho y te lo dejo listo.',
          ],
      conversationMemory.sentMessages,
    );
  }

  private buildMicroIntentDecision(
    contactId: string,
    message: string,
    microIntent: MicroIntentKind,
    salesActive: boolean,
  ): BotDecisionState {
    const normalized = this.normalizeTextForMatch(message);

    if (microIntent === 'status') {
      return {
        intent: salesActive ? 'interesado' : 'otro',
        classificationSource: 'rules',
        stage: salesActive ? 'interesado' : 'curioso',
        action: 'guiar',
        purchaseIntentScore: salesActive ? 15 : 5,
        currentIntent: 'micro_status',
        summaryText: 'Micro intent status/ack handled before thinking.',
        keyFacts: { microIntent: 'status', salesActive },
        lastMessageId: `micro_status:${contactId}:${this.hashValue(normalized || 'empty')}`,
      };
    }

    if (microIntent === 'yes') {
      return {
        intent: salesActive ? 'compra' : 'interesado',
        classificationSource: 'rules',
        stage: salesActive ? 'listo' : 'interesado',
        action: salesActive ? 'cerrar' : 'guiar',
        purchaseIntentScore: salesActive ? 85 : 30,
        currentIntent: 'micro_yes',
        summaryText: 'Micro intent yes handled before thinking.',
        keyFacts: { microIntent: 'yes', salesActive },
        lastMessageId: `micro_yes:${contactId}:${this.hashValue(normalized || 'empty')}`,
      };
    }

    if (microIntent === 'no') {
      return {
        intent: 'duda',
        classificationSource: 'rules',
        stage: 'dudoso',
        action: 'persuadir',
        purchaseIntentScore: 10,
        currentIntent: 'micro_no',
        summaryText: 'Micro intent no handled before thinking.',
        keyFacts: { microIntent: 'no', salesActive },
        lastMessageId: `micro_no:${contactId}:${this.hashValue(normalized || 'empty')}`,
      };
    }

    if (microIntent === 'soft') {
      return {
        intent: 'interesado',
        classificationSource: 'rules',
        stage: salesActive ? 'interesado' : 'curioso',
        action: salesActive ? 'cerrar' : 'guiar',
        purchaseIntentScore: salesActive ? 55 : 20,
        currentIntent: 'micro_soft',
        summaryText: 'Micro intent soft acknowledgment handled before thinking.',
        keyFacts: { microIntent: 'soft', salesActive },
        lastMessageId: `micro_soft:${contactId}:${this.hashValue(normalized || 'empty')}`,
      };
    }

    return {
      intent: salesActive ? 'interesado' : 'otro',
      classificationSource: 'rules',
      stage: salesActive ? 'interesado' : 'curioso',
      action: salesActive ? 'guiar' : 'hacer_seguimiento',
      purchaseIntentScore: salesActive ? 35 : 5,
      currentIntent: 'micro_thanks',
      summaryText: 'Micro intent thanks handled before thinking.',
      keyFacts: { microIntent: 'thanks', salesActive },
      lastMessageId: `micro_thanks:${contactId}:${this.hashValue(normalized || 'empty')}`,
    };
  }

  private isSalesContextActive(lastIntent: string | null, lastQuestion: string | null): boolean {
    const normalizedIntent = (lastIntent ?? '').trim().toLowerCase();
    if (['compra', 'interesado', 'precio', 'consulta_precio', 'hot'].includes(normalizedIntent)) {
      return true;
    }

    const normalizedQuestion = this.normalizeTextForMatch(lastQuestion ?? '');
    if (!normalizedQuestion) {
      return false;
    }

    return [
      'precio',
      'pedido',
      'preparo',
      'dejo listo',
      'quieres que te',
      'como pedirlo',
      'como se usa',
    ].some((keyword) => normalizedQuestion.includes(keyword));
  }

  private findLatestAssistantQuestion(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const item = messages[index];
      if (item.role === 'assistant' && item.content.includes('?')) {
        return item.content.trim();
      }
    }

    return null;
  }

  private async rememberLastMessageType(
    contactId: string,
    messageType: 'text' | 'audio' | 'image',
  ): Promise<void> {
    await this.redisService.set(
      this.getLastMessageTypeKey(contactId),
      messageType,
      BotService.MICRO_CONTEXT_TTL_SECONDS,
    );
  }

  private async persistMicroContext(
    contactId: string,
    intent: string,
    reply: string,
    messageType: 'text' | 'audio' | 'image',
  ): Promise<void> {
    await this.redisService.set(
      this.getLastIntentKey(contactId),
      intent,
      BotService.MICRO_CONTEXT_TTL_SECONDS,
    );
    await this.redisService.set(
      this.getLastMessageTypeKey(contactId),
      messageType,
      BotService.MICRO_CONTEXT_TTL_SECONDS,
    );

    if (reply.includes('?')) {
      await this.redisService.set(
        this.getLastQuestionKey(contactId),
        reply,
        BotService.MICRO_CONTEXT_TTL_SECONDS,
      );
      return;
    }

    await this.redisService.del(this.getLastQuestionKey(contactId));
  }

  private isLongOrDetailedReply(reply: string): boolean {
    const normalized = reply.trim();
    if (!normalized) {
      return false;
    }

    if (normalized.length >= BotService.LONG_REPLY_MIN_CHARS) {
      return true;
    }

    const sentenceCount = normalized
      .split(/[.!?]+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0)
      .length;

    return sentenceCount >= 3;
  }

  private shouldAttachMediaToAiReply(
    message: string,
    intent: BotIntent,
    mediaIntent: MediaIntent,
    action: BotDecisionAction,
    hasProductCatalog: boolean,
    hasRelevantProducts: boolean,
  ): boolean {
    if (mediaIntent !== null) {
      return true;
    }

    if (!hasProductCatalog) {
      return intent === 'catalogo' || this.isVisualRequest(message);
    }

    if (hasRelevantProducts && (intent === 'interes' || this.requiresDetailedResponse(message))) {
      return true;
    }

    return (
      intent === 'catalogo' ||
      this.isVisualRequest(message) ||
      action === 'cerrar' ||
      action === 'responder_precio_con_valor' ||
      action === 'persuadir'
    );
  }

  private resolveResponseStyle(
    message: string,
    intent: BotIntent,
  ): AssistantResponseStyle {
    if (this.requiresDetailedResponse(message)) {
      return 'detailed';
    }

    if (this.requiresSpecificDirectAnswer(message, intent)) {
      return 'brief';
    }

    return 'balanced';
  }

  private resolveResponseStyleFromDecision(
    decision: BotDecisionState,
    message: string,
    intent: BotIntent,
  ): AssistantResponseStyle {
    if (decision.action === 'responder_precio_con_valor') {
      return 'brief';
    }

    if (decision.action === 'persuadir' || decision.action === 'hacer_seguimiento') {
      return 'balanced';
    }

    if (decision.intent === 'info') {
      return 'detailed';
    }

    return this.resolveResponseStyle(message, intent);
  }

  private mapDecisionStageToLeadStage(
    stage: ContactStage,
    hotLead: boolean,
  ): AssistantLeadStage {
    if (stage === 'listo' || hotLead) {
      return 'listo_para_comprar';
    }

    if (stage === 'dudoso') {
      return 'dudoso';
    }

    if (stage === 'interesado') {
      return 'interesado';
    }

    return 'curioso';
  }

  private mapDecisionActionToReplyObjective(
    action: BotDecisionAction,
  ): AssistantReplyObjective {
    if (action === 'cerrar') {
      return 'cerrar_venta';
    }

    if (action === 'persuadir') {
      return 'resolver_duda';
    }

    if (action === 'hacer_seguimiento') {
      return 'generar_confianza';
    }

    return 'avanzar_conversacion';
  }

  private mapDecisionIntentToBotIntent(
    intent: BotDecisionIntent,
    message: string,
  ): BotIntent {
    if (['catalogo', 'catálogo', 'catalog'].some((keyword) => message.toLowerCase().includes(keyword))) {
      return 'catalogo';
    }

    if (intent === 'compra') {
      return this.detectHotLead(message) ? 'hot' : 'compra';
    }

    if (intent === 'duda') {
      return 'duda';
    }

    if (intent === 'precio' || intent === 'info' || intent === 'interesado') {
      return 'interes';
    }

    return this.detectIntent(message);
  }

  private async runDecisionEngine(params: {
    contactId: string;
    message: string;
    history: StoredMessage[];
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>;
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>;
  }): Promise<BotDecisionState> {
    const normalizedMessage = params.message.trim();
    const cachedState = await this.readRedisCache<RedisStateSnapshot>(
      this.getStateCacheKey(params.contactId),
    );
    const currentState = cachedState ?? await this.prisma.contactState.findUnique({
      where: { contactId: params.contactId },
    });
    const cachedIntent = await this.readRedisCache<IntentCacheEntry>(
      this.getIntentCacheKey(params.contactId),
    );
    const intentResult = cachedIntent && this.areMessagesSimilar(cachedIntent.message, normalizedMessage)
      ? {
          intent: cachedIntent.intent,
          source: cachedIntent.source,
        }
      : await this.classifyIntent(
          normalizedMessage,
          params.history,
          params.config,
        );

    if (!cachedIntent || !this.areMessagesSimilar(cachedIntent.message, normalizedMessage)) {
      await this.redisService.set(
        this.getIntentCacheKey(params.contactId),
        {
          message: normalizedMessage,
          intent: intentResult.intent,
          source: intentResult.source,
          updatedAt: Date.now(),
        } satisfies IntentCacheEntry,
        BotService.INTENT_CACHE_TTL_SECONDS,
      );
    }
    const purchaseIntentScore = this.calculatePurchaseIntentScore(
      currentState?.purchaseIntentScore ?? 0,
      normalizedMessage,
      intentResult.intent,
    );
    const stage = this.updateStage(
      normalizedMessage,
      intentResult.intent,
      purchaseIntentScore,
      params.history,
      params.memoryContext,
      currentState?.stage ?? null,
    );
    const action = this.decideAction(intentResult.intent, stage);
    const lastMessageId = this.buildSyntheticMessageId(params.contactId, normalizedMessage);
    const summaryText = this.buildDecisionSummaryText(
      params.memoryContext,
      normalizedMessage,
      intentResult.intent,
      stage,
    );
    const keyFacts = this.buildDecisionKeyFacts(
      params.memoryContext,
      intentResult.intent,
      stage,
      purchaseIntentScore,
      action,
    );

    await this.prisma.contactState.upsert({
      where: { contactId: params.contactId },
      create: {
        contactId: params.contactId,
        name: params.memoryContext.clientMemory.name,
        currentIntent: intentResult.intent,
        stage,
        lastInteractionAt: new Date(),
        purchaseIntentScore,
        notesJson: keyFacts as Prisma.InputJsonValue,
      },
      update: {
        name: params.memoryContext.clientMemory.name,
        currentIntent: intentResult.intent,
        stage,
        lastInteractionAt: new Date(),
        purchaseIntentScore,
        notesJson: keyFacts as Prisma.InputJsonValue,
      },
    });

    await this.prisma.contactConversationSummary.upsert({
      where: { contactId: params.contactId },
      create: {
        contactId: params.contactId,
        summaryText,
        keyFactsJson: keyFacts as Prisma.InputJsonValue,
        lastMessageId,
      },
      update: {
        summaryText,
        keyFactsJson: keyFacts as Prisma.InputJsonValue,
        lastMessageId,
      },
    });

    await this.redisService.set(
      this.getStateCacheKey(params.contactId),
      {
        stage,
        currentIntent: intentResult.intent,
        purchaseIntentScore,
        updatedAt: Date.now(),
      } satisfies RedisStateSnapshot,
      BotService.STATE_CACHE_TTL_SECONDS,
    );

    return {
      intent: intentResult.intent,
      classificationSource: intentResult.source,
      stage,
      action,
      purchaseIntentScore,
      currentIntent: intentResult.intent,
      summaryText,
      keyFacts,
      lastMessageId,
    };
  }

  private async markBotResponseInDecisionState(
    contactId: string,
    reply: string,
    decision: BotDecisionState,
    mediaFiles: MediaFile[],
  ): Promise<void> {
    const now = new Date();
    const existingState = await this.prisma.contactState.findUnique({
      where: { contactId },
    });
    const existingNotes = this.asRecord(existingState?.notesJson);
    const sentMediaUrls = Array.from(
      new Set([
        ...this.asStringList(existingNotes.sentMediaUrls),
        ...mediaFiles.map((file) => file.fileUrl).filter((url) => url.trim().length > 0),
      ]),
    ).slice(-12);

    await this.redisService.set(
      `${BotService.SENT_MEDIA_CACHE_KEY_PREFIX}${contactId}`,
      sentMediaUrls,
    );

    await this.prisma.contactState.updateMany({
      where: { contactId },
      data: {
        lastBotMessageAt: now,
        notesJson: {
          ...(decision.keyFacts as Record<string, unknown>),
          lastBotReply: reply,
          lastAction: decision.action,
          sentMediaUrls,
        },
      },
    });
  }

  private async classifyIntent(
    message: string,
    history: StoredMessage[],
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
  ): Promise<{ intent: BotDecisionIntent; source: BotDecisionState['classificationSource'] }> {
    const normalized = message.trim().toLowerCase();

    if (!normalized) {
      return { intent: 'otro', source: 'heuristic_fallback' };
    }

    if (['precio', 'cuánto', 'cuanto', 'vale'].some((keyword) => normalized.includes(keyword))) {
      return { intent: 'precio', source: 'rules' };
    }

    if (this.requiresDetailedResponse(message)) {
      return { intent: 'info', source: 'rules' };
    }

    if (['cómo compro', 'como compro', 'pago', 'cuenta', 'envio', 'envío'].some((keyword) => normalized.includes(keyword))) {
      return { intent: 'compra', source: 'rules' };
    }

    if (['funciona', 'sirve', 'es verdad'].some((keyword) => normalized.includes(keyword))) {
      return { intent: 'duda', source: 'rules' };
    }

    if (['info', 'qué es', 'que es'].some((keyword) => normalized.includes(keyword))) {
      return { intent: 'info', source: 'rules' };
    }

    if (['no quiero', 'no me interesa', 'ya no'].some((keyword) => normalized.includes(keyword))) {
      return { intent: 'no_interesado', source: 'rules' };
    }

    const aiIntent = await this.aiService.classifyIntent({
      config,
      message,
      history,
    });

    if (aiIntent !== 'curioso') {
      return { intent: aiIntent, source: 'ai_fallback' };
    }

    if (this.hasComparisonSignal(message)) {
      return { intent: 'interesado', source: 'heuristic_fallback' };
    }

    if (this.hasSkepticalSignal(message)) {
      return { intent: 'duda', source: 'heuristic_fallback' };
    }

    if (this.detectHotLead(message)) {
      return { intent: 'compra', source: 'heuristic_fallback' };
    }

    if (this.requiresDetailedResponse(message)) {
      return { intent: 'info', source: 'heuristic_fallback' };
    }

    return { intent: 'curioso', source: 'heuristic_fallback' };
  }

  private updateStage(
    message: string,
    intent: BotDecisionIntent,
    purchaseIntentScore: number,
    history: StoredMessage[],
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
    currentStage: string | null,
  ): ContactStage {
    if (currentStage === 'cliente' || memoryContext.clientMemory.status === 'cliente') {
      return 'cliente';
    }

    if (
      intent === 'compra' ||
      this.detectHotLead(message) ||
      (history.length === 0 && this.isCloseSignal(message)) ||
      purchaseIntentScore >= 80
    ) {
      return 'listo';
    }

    if (intent === 'duda' || this.hasSkepticalSignal(message)) {
      return 'dudoso';
    }

    if (this.isDryAcknowledgement(message, history) || this.isVeryShortCustomerReply(message)) {
      return 'curioso';
    }

    if (
      intent === 'precio' ||
      intent === 'info' ||
      intent === 'interesado' ||
      this.hasComparisonSignal(message) ||
      purchaseIntentScore >= 20
    ) {
      return 'interesado';
    }

    return 'curioso';
  }

  private decideAction(intent: BotDecisionIntent, stage: ContactStage): BotDecisionAction {
    if (stage === 'cliente') {
      return 'hacer_seguimiento';
    }

    if (stage === 'listo') {
      return 'cerrar';
    }

    if (intent === 'precio') {
      return 'responder_precio_con_valor';
    }

    if (intent === 'duda') {
      return 'persuadir';
    }

    if (intent === 'no_interesado') {
      return 'hacer_seguimiento';
    }

    return 'guiar';
  }

  private calculatePurchaseIntentScore(
    currentScore: number,
    message: string,
    intent: BotDecisionIntent,
  ): number {
    const normalized = message.trim().toLowerCase();
    let nextScore = currentScore;

    if (intent === 'precio' || ['precio', 'cuánto', 'cuanto', 'vale'].some((keyword) => normalized.includes(keyword))) {
      nextScore += 20;
    }

    if (intent === 'compra' || ['cómo compro', 'como compro', 'pago', 'cuenta'].some((keyword) => normalized.includes(keyword))) {
      nextScore += 30;
    }

    if (['envio', 'envío', 'delivery'].some((keyword) => normalized.includes(keyword))) {
      nextScore += 40;
    }

    if (/(^|\s)no($|\s)|no quiero|no me interesa/.test(normalized)) {
      nextScore -= 20;
    }

    return Math.max(0, Math.min(100, nextScore));
  }

  private buildDecisionSummaryText(
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
    message: string,
    intent: BotDecisionIntent,
    stage: ContactStage,
  ): string {
    if (memoryContext.summary.summary?.trim()) {
      return memoryContext.summary.summary.trim();
    }

    const lines = memoryContext.messages
      .slice(-4)
      .map((item) => `${item.role}: ${item.content}`)
      .join(' | ');

    return [
      `Etapa: ${stage}`,
      `Intencion: ${intent}`,
      `Ultimo mensaje: ${message}`,
      lines ? `Historial reciente: ${lines}` : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join('\n');
  }

  private buildDecisionKeyFacts(
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
    intent: BotDecisionIntent,
    stage: ContactStage,
    purchaseIntentScore: number,
    action: BotDecisionAction,
  ): Record<string, unknown> {
    return {
      name: memoryContext.clientMemory.name,
      objective: memoryContext.clientMemory.objective,
      interest: memoryContext.clientMemory.interest,
      objections: memoryContext.clientMemory.objections,
      lastIntent: memoryContext.clientMemory.lastIntent,
      stage,
      currentIntent: intent,
      purchaseIntentScore,
      action,
      summary: memoryContext.summary.summary,
    };
  }

  private buildSyntheticMessageId(contactId: string, message: string): string {
    const compact = message.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24);
    return `${contactId}:${Date.now()}:${compact}`;
  }

  private isVeryShortCustomerReply(message: string): boolean {
    const words = message.trim().split(/\s+/).filter((word) => word.length > 0);
    return words.length > 0 && words.length <= 2 && message.trim().length <= 12;
  }

  private isCloseSignal(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return ['ok', 'perfecto', 'dale', 'esta bien', 'está bien'].includes(normalized);
  }

  private resolveLeadStage(
    message: string,
    intent: BotIntent,
    hotLead: boolean,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): AssistantLeadStage {
    if (this.hasComparisonSignal(message)) {
      return 'interesado';
    }

    if (this.hasSkepticalSignal(message)) {
      return 'dudoso';
    }

    if (this.isDryAcknowledgement(message, history)) {
      return 'curioso';
    }

    if (this.requiresDetailedResponse(message)) {
      return 'curioso';
    }

    if (hotLead || intent === 'hot' || intent === 'compra' || intent === 'cierre') {
      return 'listo_para_comprar';
    }

    if (intent === 'duda') {
      return 'dudoso';
    }

    if (intent === 'interes') {
      return 'interesado';
    }

    return 'curioso';
  }

  private resolveReplyObjective(
    message: string,
    intent: BotIntent,
    hotLead: boolean,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): AssistantReplyObjective {
    if (this.hasComparisonSignal(message)) {
      return 'generar_confianza';
    }

    if (this.hasSkepticalSignal(message)) {
      return 'resolver_duda';
    }

    if (this.isDryAcknowledgement(message, history)) {
      return 'generar_confianza';
    }

    if (this.requiresDetailedResponse(message)) {
      return 'generar_confianza';
    }

    if (hotLead || intent === 'hot' || intent === 'compra' || intent === 'cierre') {
      return 'cerrar_venta';
    }

    if (intent === 'duda') {
      return 'resolver_duda';
    }

    return 'avanzar_conversacion';
  }

  private shouldTreatAsHotLead(
    message: string,
    intent: BotIntent,
    lastIntent: string | null,
  ): boolean {
    if (this.detectHotLead(message)) {
      return true;
    }

    if (lastIntent !== 'HOT') {
      return false;
    }

    if (
      this.requiresDetailedResponse(message)
      || this.requiresDetailedResponse(this.normalizeTextForMatch(message))
    ) {
      return false;
    }

    return intent === 'compra' || intent === 'cierre' || intent === 'interes' || intent === 'hot';
  }

  private validateAiKnowledgeQuality(params: {
    message: string;
    reply: string;
    intent: BotIntent;
    mediaCount: number;
    relevantProduct: StructuredProduct | null;
    allProducts: StructuredProduct[];
  }): { valid: boolean; reason?: ResponseValidationReason } {
    // If we're attaching media, the content value can be carried by the media + short caption.
    if (params.mediaCount > 0) {
      return { valid: true };
    }

    const messageNormalized = this.normalizeTextForMatch(params.message);
    const replyNormalized = this.normalizeTextForMatch(params.reply);
    const questionCount = (params.reply.match(/\?/g) ?? []).length;

    if (!replyNormalized) {
      return { valid: false, reason: 'no_new_content' };
    }

    // Only enforce product-backed answers when we actually have a catalog to use.
    if (params.allProducts.length === 0) {
      return { valid: true };
    }

    // Skip product enforcement for pure greetings / pure closures / company-only questions.
    if (this.isGreetingOnlyMessage(params.message) || this.isCloseSignal(params.message)) {
      return { valid: true };
    }

    const companyOnlyTerms = [
      'ubicacion',
      'direccion',
      'horario',
      'telefono',
      'whatsapp',
      'pago',
      'cuenta',
      'transferencia',
      'tarjeta',
      'mapa',
    ];
    if (companyOnlyTerms.some((term) => messageNormalized.includes(term))) {
      return { valid: true };
    }

    const productTitle = params.relevantProduct?.titulo?.trim() ?? '';
    const productTitleNormalized = productTitle ? this.normalizeTextForMatch(productTitle) : '';
    const mentionsProduct = productTitleNormalized ? replyNormalized.includes(productTitleNormalized) : false;

    const replyMentionsPrice = this.replyMentionsPrice(params.reply, replyNormalized);

    const mentionsPrice = replyMentionsPrice
      || replyNormalized.includes('no tengo el precio')
      || replyNormalized.includes('no esta configurado')
      || replyNormalized.includes('no está configurado');

    const mentionsUsage = [
      'como se usa',
      'como se toma',
      'modo de uso',
      'dosis',
      'toma',
      'tomar',
      'usar',
    ].some((term) => replyNormalized.includes(term));

    const mentionsBenefits = [
      'beneficio',
      'beneficios',
      'resultado',
      'resultados',
      'ayuda',
      'funciona',
      'sirve',
      'apetito',
    ].some((term) => replyNormalized.includes(term));

    const hasFunction = [
      'funciona',
      'sirve',
      'se usa',
      'se toma',
      'modo de uso',
      'toma',
      'tomarlo',
      'usar',
    ].some((term) => replyNormalized.includes(this.normalizeTextForMatch(term)));

    const extractedProductTokens = params.allProducts
      .flatMap((product) => {
        const blob = `${product.descripcionCorta ?? ''} ${product.descripcionCompleta ?? ''}`.trim();
        return this.tokenizeNormalized(blob, { minTokenLength: 5, maxTokens: 12 });
      })
      .filter((token) => token.length > 0);

    const hasBenefit = mentionsBenefits || extractedProductTokens.some((token) => token && replyNormalized.includes(token));

    const needsDetected = this.inferNeedsFromNormalizedMessage(messageNormalized);
    const hasNeedConnection = this.hasNeedConnection({
      normalizedReply: replyNormalized,
      questionCount,
      needs: needsDetected,
    });

    const hasKnownPriceIfMentionsPrice = this.hasKnownPriceIfMentionsPrice({
      reply: params.reply,
      normalizedReply: replyNormalized,
      products: params.allProducts,
      replyMentionsPrice,
    });

    if (!hasKnownPriceIfMentionsPrice) {
      return { valid: false, reason: 'coherence_mismatch' };
    }

    const broadInfoRequest =
      (messageNormalized.includes('informacion') || messageNormalized.includes('info'))
      && !messageNormalized.includes('precio')
      && !messageNormalized.includes('como')
      && !messageNormalized.includes('funciona')
      && !messageNormalized.includes('beneficio')
      && !messageNormalized.includes('resultado');
    const isClarifyingGuidance = [
      'dime',
      'que te interesa',
      'que quieres saber',
      'con que te ayudo',
      'en que te puedo ayudar',
    ].some((phrase) => replyNormalized.includes(phrase));
    if (broadInfoRequest && isClarifyingGuidance) {
      return { valid: true };
    }

    const isTooGeneric =
      replyNormalized.length < 70
      && [
        'claro',
        'perfecto',
        'te ayudo',
        'te ayudo con eso',
        'depende',
        'tenemos varias opciones',
        'tenemos opciones',
        'dime',
        'listo',
      ].some((phrase) => replyNormalized.includes(phrase))
      && !(mentionsProduct || mentionsPrice || mentionsUsage || mentionsBenefits);

    if (isTooGeneric && (params.intent === 'interes' || params.intent === 'compra' || params.intent === 'duda')) {
      return { valid: false, reason: 'generic_no_product' };
    }

    const askedBoth = messageNormalized.includes('ambas')
      || messageNormalized.includes('las dos')
      || messageNormalized.includes('los dos')
      || messageNormalized.includes('las dos cosas')
      || messageNormalized.includes('los dos');
    if (askedBoth && !(mentionsBenefits && (mentionsUsage || mentionsPrice))) {
      return { valid: false, reason: 'missing_dual_answer' };
    }

    const closeOrSellPhrases = [
      'dame tu direccion',
      'dame tu dirección',
      'pasame tu ubicacion',
      'pásame tu ubicación',
      'para el pedido',
      'vamos a pedirlo',
      'vamos a pedir',
      'te lo envio',
      'te lo envío',
    ];
    const triesToClose = closeOrSellPhrases.some((phrase) => replyNormalized.includes(this.normalizeTextForMatch(phrase)));
    if (triesToClose && !(hasBenefit && hasFunction)) {
      return { valid: false, reason: 'sales_flow_violation' };
    }

    // Minimum enforcement for every non-greeting / non-closure when products exist.
    if (!(hasBenefit && hasFunction && hasNeedConnection)) {
      return { valid: false, reason: 'missing_minimum_product_value' };
    }

    return { valid: true };
  }

  private requiresDetailedResponse(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'explicame',
      'explícame',
      'hablame',
      'háblame',
      'cuentame',
      'cuéntame',
      'dime mas',
      'dime más',
      'quiero saber',
      'me gustaria saber',
      'me gustaría saber',
      'como funciona',
      'cómo funciona',
      'como se usa',
      'cómo se usa',
      'como se toma',
      'cómo se toma',
      'modo de uso',
      'paso por paso',
      'instrucciones',
      'que contiene',
      'qué contiene',
      'beneficios',
      'hablame un poco',
      'háblame un poco',
      'un poco de',
      'de la pastilla',
      'de las pastillas',
      'informacion',
      'información',
      'detalle',
      'detalles',
    ].some((keyword) => normalized.includes(keyword));
  }

  private requiresSpecificDirectAnswer(message: string, intent: BotIntent): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'precio',
      'cuanto cuesta',
      'cuánto cuesta',
      'cuanto vale',
      'cuánto vale',
      'disponible',
      'hay disponible',
      'envio',
      'envío',
      'delivery',
    ].some((keyword) => normalized.includes(keyword));
  }

  private hasSkepticalSignal(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'funciona de verdad',
      'eso funciona',
      'seguro',
      'me da miedo',
      'no quiero botar mi dinero',
      'y si no me funciona',
      'es verdad',
      'sirve de verdad',
    ].some((keyword) => normalized.includes(keyword));
  }

  private hasComparisonSignal(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'mejor que',
      'más que la otra',
      'mas que la otra',
      'igual que la otra',
      'como la otra',
      'que la otra',
      'vs',
      'versus',
      'compar',
      'otra que venden',
      'otro producto',
      'otra pastilla',
    ].some((keyword) => normalized.includes(keyword));
  }

  private isDryAcknowledgement(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized || history.length === 0 || this.detectHotLead(normalized)) {
      return false;
    }

    return [
      'ok',
      'oka',
      'okey',
      'okeys',
      'dale',
      'aja',
      'ajá',
      'mmm',
      'mm',
      'hmm',
      'si',
      'sí',
      'ta bien',
      'está bien',
      'esta bien',
    ].includes(normalized);
  }

  private prefersVoiceReply(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'nota de voz',
      'audio',
      'voz',
      'hablame',
      'háblame',
      'explicame por voz',
      'explícame por voz',
      'mandame un audio',
      'mándame un audio',
      'responde por audio',
      'respondeme por audio',
      'respóndeme por audio',
    ].some((keyword) => normalized.includes(keyword));
  }

  private isVisualRequest(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return [
      'foto',
      'fotos',
      'imagen',
      'imagenes',
      'imágenes',
      'catalogo',
      'catálogo',
      'muestrame',
      'muéstrame',
      'ensename',
      'enséñame',
      'ver',
      'referencia',
      'referencias',
      'antes y despues',
      'antes y después',
      'resultado',
      'resultados',
    ].some((keyword) => normalized.includes(keyword));
  }

  private hasUsefulMemory(
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
    historyLength: number,
  ): boolean {
    return Boolean(
      historyLength > 0 ||
        memoryContext.summary.summary?.trim() ||
        memoryContext.clientMemory.name ||
        memoryContext.clientMemory.objective ||
        memoryContext.clientMemory.interest ||
        (memoryContext.clientMemory.objections?.length ?? 0) > 0 ||
        memoryContext.clientMemory.status !== 'nuevo',
    );
  }

  private isShortReply(reply: string): boolean {
    const lineCount = reply.split('\n').filter((line) => line.trim().length > 0).length;
    const wordCount = reply.split(/\s+/).filter((word) => word.length > 0).length;
    return lineCount <= 2 && wordCount <= 15;
  }

  private looksLikeSalesClose(reply: string): boolean {
    const normalized = reply.toLowerCase();
    return ['te lo envío', 'te lo envio', 'lo dejo listo', 'hoy'].some((keyword) => normalized.includes(keyword));
  }

  private logReply(contactId: string, result: BotReplyResult): void {
    this.logger.log(
      JSON.stringify({
        event: 'bot_reply_generated',
        contactId,
        intent: result.intent,
        hotLead: result.hotLead,
        usedMemory: result.usedMemory,
        usedGallery: result.usedGallery,
        cached: result.cached,
        source: result.source,
        replyType: result.replyType,
      }),
    );
  }

  private excludeCurrentUserMessage(
    history: Awaited<ReturnType<MemoryService['getRecentMessages']>>,
    currentMessage: string,
  ) {
    if (history.length === 0) {
      return history;
    }

    const lastMessage = history[history.length - 1];
    if (
      lastMessage.role === 'user' &&
      lastMessage.content.trim() === currentMessage.trim()
    ) {
      return history.slice(0, -1);
    }

    return history;
  }
}
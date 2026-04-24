import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { ConversationFollowup } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import {
  AssistantLeadStage,
  AssistantReplyObjective,
  AssistantResponseStyle,
} from '../ai/ai.types';
import { BotDecisionAction, BotDecisionIntent } from '../bot/bot-decision.types';
import { BotConfigService } from '../bot-config/bot-config.service';
import { CompanyContextService } from '../company-context/company-context.service';
import { ClientConfigService } from '../config/config.service';
import { MemoryService } from '../memory/memory.service';
import { ClientMemorySnapshot, StoredMessage } from '../memory/memory.types';
import { PrismaService } from '../prisma/prisma.service';

type FollowupConfig = {
  enabled: boolean;
  followup1DelayMinutes: number;
  followup2DelayMinutes: number;
  followup3DelayHours: number;
  maxFollowups: number;
  stopIfUserReply: boolean;
};

@Injectable()
export class FollowupService {
  private readonly logger = new Logger(FollowupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly botConfigService: BotConfigService,
    private readonly companyContextService: CompanyContextService,
    private readonly clientConfigService: ClientConfigService,
    private readonly memoryService: MemoryService,
  ) {}

  async registerBotReply(params: {
    contactId: string;
    outboundAddress?: string | null;
    reply: string;
  }): Promise<void> {
    const contactId = this.normalizeContactId(params.contactId);
    const config = await this.getFollowupConfig();

    if (!config.enabled) {
      await this.deactivate(contactId, 'disabled');
      return;
    }

    const context = await this.memoryService.getConversationContext(contactId, 10);
    if (this.shouldSuppressFollowup(context.clientMemory, context.messages)) {
      await this.deactivate(contactId, 'suppressed');
      return;
    }

    await this.prisma.conversationFollowup.upsert({
      where: { contactId },
      create: {
        contactId,
        outboundAddress: this.normalizeOutboundAddress(params.outboundAddress, contactId),
        lastMessageFrom: 'bot',
        lastMessageAt: new Date(),
        followupStep: 0,
        isActive: true,
        nextFollowupAt: this.computeNextFollowupAt(0, new Date(), config),
        lastFollowupMessage: params.reply.trim() || null,
      },
      update: {
        outboundAddress: this.normalizeOutboundAddress(params.outboundAddress, contactId),
        lastMessageFrom: 'bot',
        lastMessageAt: new Date(),
        followupStep: 0,
        isActive: true,
        nextFollowupAt: this.computeNextFollowupAt(0, new Date(), config),
        lastFollowupMessage: params.reply.trim() || null,
      },
    });
  }

  async registerUserReply(contactId: string): Promise<void> {
    const normalizedContactId = this.normalizeContactId(contactId);
    const config = await this.getFollowupConfig();

    await this.prisma.conversationFollowup.updateMany({
      where: { contactId: normalizedContactId },
      data: {
        lastMessageFrom: 'user',
        lastMessageAt: new Date(),
        isActive: config.stopIfUserReply ? false : true,
        nextFollowupAt: null,
      },
    });
  }

  async getFollowupState(contactId: string) {
    const normalizedContactId = this.normalizeContactId(contactId);
    const followup = await this.prisma.conversationFollowup.findUnique({
      where: { contactId: normalizedContactId },
    });

    return this.toFollowupSnapshot(normalizedContactId, followup);
  }

  async scheduleManualFollowup(params: {
    contactId: string;
    outboundAddress?: string | null;
    reply?: string | null;
    nextFollowupAt?: Date | null;
  }) {
    const contactId = this.normalizeContactId(params.contactId);
    const config = await this.getFollowupConfig();

    if (!config.enabled) {
      throw new BadRequestException('Followups are disabled in bot settings');
    }

    const nextFollowupAt = params.nextFollowupAt ?? this.computeNextFollowupAt(0, new Date(), config);
    if (nextFollowupAt == null || Number.isNaN(nextFollowupAt.getTime())) {
      throw new BadRequestException('nextFollowupAt is invalid');
    }

    const normalizedReply = params.reply?.trim() || null;
    const followup = await this.prisma.conversationFollowup.upsert({
      where: { contactId },
      create: {
        contactId,
        outboundAddress: this.normalizeOutboundAddress(params.outboundAddress, contactId),
        lastMessageFrom: 'bot',
        lastMessageAt: new Date(),
        followupStep: 0,
        isActive: true,
        nextFollowupAt,
        lastFollowupMessage: normalizedReply,
      },
      update: {
        outboundAddress: this.normalizeOutboundAddress(params.outboundAddress, contactId),
        lastMessageFrom: 'bot',
        lastMessageAt: new Date(),
        followupStep: 0,
        isActive: true,
        nextFollowupAt,
        lastFollowupMessage: normalizedReply,
      },
    });

    return this.toFollowupSnapshot(contactId, followup);
  }

  async sendManualMessage(params: {
    contactId: string;
    outboundAddress?: string | null;
    message: string;
    scheduleFollowup?: boolean;
  }) {
    const contactId = this.normalizeContactId(params.contactId);
    const message = params.message.trim();

    if (!message) {
      throw new BadRequestException('message is required');
    }

    const outboundAddress = this.normalizeOutboundAddress(params.outboundAddress, contactId);
    await this.sendFollowupText(outboundAddress, message);
    await this.memoryService.saveMessage({
      contactId,
      role: 'assistant',
      content: message,
    });

    if (params.scheduleFollowup ?? true) {
      await this.registerBotReply({
        contactId,
        outboundAddress,
        reply: message,
      });
    } else {
      await this.deactivate(contactId, 'manual_send_without_followup');
    }

    return {
      contactId,
      outboundAddress,
      message,
      sentAt: new Date().toISOString(),
      followup: await this.getFollowupState(contactId),
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processDueFollowups(): Promise<void> {
    const config = await this.getFollowupConfig();
    if (!config.enabled) {
      return;
    }

    const now = new Date();
    const due = await this.prisma.conversationFollowup.findMany({
      where: {
        isActive: true,
        lastMessageFrom: 'bot',
        nextFollowupAt: { lte: now },
      },
      orderBy: { nextFollowupAt: 'asc' },
      take: 20,
    });

    for (const item of due) {
      await this.processSingleFollowup(item, config);
    }
  }

  private async processSingleFollowup(
    followup: ConversationFollowup,
    config: FollowupConfig,
  ): Promise<void> {
    if (followup.followupStep >= config.maxFollowups) {
      await this.deactivate(followup.contactId, 'max_reached');
      return;
    }

    const memoryContext = await this.memoryService.getConversationContext(followup.contactId, 10);
    if (this.shouldSuppressFollowup(memoryContext.clientMemory, memoryContext.messages)) {
      await this.deactivate(followup.contactId, 'suppressed');
      return;
    }

    const nextStep = followup.followupStep + 1;
    const message = await this.generateFollowupMessage(followup, nextStep, memoryContext);
    const outboundAddress = this.normalizeOutboundAddress(followup.outboundAddress, followup.contactId);

    try {
      await this.sendFollowupText(outboundAddress, message);
      await this.memoryService.saveMessage({
        contactId: followup.contactId,
        role: 'assistant',
        content: message,
      });

      const reachedMax = nextStep >= config.maxFollowups;
      await this.prisma.conversationFollowup.update({
        where: { contactId: followup.contactId },
        data: {
          lastMessageFrom: 'bot',
          lastMessageAt: new Date(),
          followupStep: nextStep,
          isActive: !reachedMax,
          nextFollowupAt: reachedMax
            ? null
            : this.computeNextFollowupAt(nextStep, new Date(), config),
          lastFollowupMessage: message,
          outboundAddress,
        },
      });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'followup_send_failed',
          contactId: followup.contactId,
          followupStep: nextStep,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      );

      await this.prisma.conversationFollowup.update({
        where: { contactId: followup.contactId },
        data: {
          nextFollowupAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
    }
  }

  private async generateFollowupMessage(
    followup: ConversationFollowup,
    step: number,
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
  ): Promise<string> {
    const config = await this.clientConfigService.getConfig();
    const botConfig = await this.botConfigService.getConfig();
    const companyContext = await this.companyContextService.buildAgentContext();
    const history = memoryContext.messages.slice(-8);
    const leadStage = this.resolveLeadStage(memoryContext.clientMemory, history);
    const replyObjective = this.resolveReplyObjective(step, leadStage);
    const classifiedIntent = this.resolveClassifiedIntent(memoryContext.clientMemory, history);
    const decisionAction = this.resolveDecisionAction(step, leadStage);
    const purchaseIntentScore = this.resolvePurchaseIntentScore(leadStage, step);
    const responseStyle: AssistantResponseStyle = step >= 2 ? 'brief' : 'balanced';
    const instruction = this.buildFollowupInstruction(step, followup, memoryContext);

    try {
      const reply = await this.aiService.generateReply({
        config,
        fullPrompt: `${this.botConfigService.getFullPrompt(botConfig)}\n\n${instruction}`,
        companyContext,
        contactId: followup.contactId,
        message: instruction,
        history,
        context: this.buildMemoryContext(memoryContext, followup),
        classifiedIntent,
        decisionAction,
        purchaseIntentScore,
        responseStyle,
        leadStage,
        replyObjective,
      });

      const candidate = reply.content.trim();
      if (candidate && !this.wasRecentlyRepeated(candidate, followup, history)) {
        return candidate;
      }
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'followup_ai_generation_failed',
          contactId: followup.contactId,
          followupStep: step,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
    }

    return this.pickFallbackMessage(step, memoryContext, followup);
  }

  private buildFollowupInstruction(
    step: number,
    followup: ConversationFollowup,
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
  ): string {
    const elapsedMinutes = Math.max(
      1,
      Math.round((Date.now() - followup.lastMessageAt.getTime()) / (60 * 1000)),
    );

    return [
      'Genera un mensaje de seguimiento por WhatsApp para un cliente que no ha respondido.',
      `Paso de seguimiento actual: ${step}.`,
      `Han pasado aproximadamente ${elapsedMinutes} minutos desde el ultimo mensaje del bot.`,
      memoryContext.clientMemory.name
        ? `Usa el nombre ${memoryContext.clientMemory.name} solo si suena natural.`
        : 'No inventes nombre si no existe.',
      'No digas que eres un sistema automatico ni que este es un seguimiento programado.',
      'No repitas literalmente el ultimo mensaje enviado.',
      'Debe sonar como un humano dominicano que retoma la conversacion con tacto.',
      'Mantente breve: 1 o 2 lineas como maximo.',
      step === 1
        ? 'Tono: suave y curioso, para retomar sin presion.'
        : step === 2
          ? 'Tono: mas directo, pero amable y natural.'
          : 'Tono: cierre elegante, abierto a ayudar rapido sin insistir demasiado.',
      'No envíes preguntas innecesarias. Solo una, si ayuda a mover la conversacion.',
    ].join(' ');
  }

  private buildMemoryContext(
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
    followup: ConversationFollowup,
  ): string {
    const lines = [
      memoryContext.summary.summary?.trim()
        ? `Resumen de la conversacion: ${memoryContext.summary.summary.trim()}`
        : null,
      memoryContext.clientMemory.objective
        ? `Objetivo del cliente: ${memoryContext.clientMemory.objective}`
        : null,
      memoryContext.clientMemory.interest
        ? `Interes principal: ${memoryContext.clientMemory.interest}`
        : null,
      memoryContext.clientMemory.status !== 'nuevo'
        ? `Estado del cliente: ${memoryContext.clientMemory.status}`
        : null,
      memoryContext.clientMemory.objections.length > 0
        ? `Objeciones detectadas: ${memoryContext.clientMemory.objections.join(', ')}`
        : null,
      followup.lastFollowupMessage?.trim()
        ? `Ultimo mensaje enviado: ${followup.lastFollowupMessage.trim()}`
        : null,
      'Usa esta memoria para que el seguimiento se sienta coherente y natural.',
    ].filter((value): value is string => Boolean(value));

    return lines.join('\n');
  }

  private resolveLeadStage(
    clientMemory: ClientMemorySnapshot,
    history: StoredMessage[],
  ): AssistantLeadStage {
    if (clientMemory.status === 'cliente' || clientMemory.objective === 'comprar') {
      return 'listo_para_comprar';
    }

    if (clientMemory.objections.length > 0 || history.some((item) => /funciona|sirve|miedo|duda|seguro/i.test(item.content))) {
      return 'dudoso';
    }

    if (clientMemory.interest || clientMemory.objective) {
      return 'interesado';
    }

    return 'curioso';
  }

  private resolveReplyObjective(
    step: number,
    leadStage: AssistantLeadStage,
  ): AssistantReplyObjective {
    if (leadStage === 'dudoso') {
      return 'resolver_duda';
    }

    if (leadStage === 'listo_para_comprar' || step >= 3) {
      return 'cerrar_venta';
    }

    return step === 1 ? 'avanzar_conversacion' : 'generar_confianza';
  }

  private resolveClassifiedIntent(
    clientMemory: ClientMemorySnapshot,
    history: StoredMessage[],
  ): BotDecisionIntent {
    if (clientMemory.status === 'cliente' || clientMemory.objective === 'comprar') {
      return 'compra';
    }

    if (clientMemory.objections.length > 0 || history.some((item) => /funciona|sirve|miedo|duda|seguro/i.test(item.content))) {
      return 'duda';
    }

    if (clientMemory.interest === 'precio') {
      return 'precio';
    }

    if (clientMemory.interest || clientMemory.objective) {
      return 'interesado';
    }

    return 'curioso';
  }

  private resolveDecisionAction(
    step: number,
    leadStage: AssistantLeadStage,
  ): BotDecisionAction {
    if (leadStage === 'listo_para_comprar' || step >= 3) {
      return 'cerrar';
    }

    if (leadStage === 'dudoso') {
      return 'persuadir';
    }

    return 'hacer_seguimiento';
  }

  private resolvePurchaseIntentScore(
    leadStage: AssistantLeadStage,
    step: number,
  ): number {
    const base = leadStage === 'listo_para_comprar'
      ? 88
      : leadStage === 'dudoso'
        ? 52
        : leadStage === 'interesado'
          ? 68
          : 40;

    return Math.min(base + Math.max(step - 1, 0) * 4, 95);
  }

  private wasRecentlyRepeated(
    candidate: string,
    followup: ConversationFollowup,
    history: StoredMessage[],
  ): boolean {
    const normalizedCandidate = this.normalizeComparable(candidate);
    if (!normalizedCandidate) {
      return true;
    }

    if (this.normalizeComparable(followup.lastFollowupMessage ?? '') === normalizedCandidate) {
      return true;
    }

    return history.some(
      (item) => item.role === 'assistant' && this.normalizeComparable(item.content) === normalizedCandidate,
    );
  }

  private pickFallbackMessage(
    step: number,
    memoryContext: Awaited<ReturnType<MemoryService['getConversationContext']>>,
    followup: ConversationFollowup,
  ): string {
    const namePrefix = memoryContext.clientMemory.name ? `${memoryContext.clientMemory.name}, ` : '';
    const variants = step === 1
      ? [
          `${namePrefix}hola 👋 ¿pudiste ver lo que te envié?`,
          `${namePrefix}te escribo suave por aquí por si no llegaste a verlo bien 👍`,
          `${namePrefix}solo paso a confirmar si viste lo que te mandé hace un rato.`,
        ]
      : step === 2
        ? [
            `${namePrefix}te escribo para ver si todavía te interesa 👍`,
            `${namePrefix}si quieres sigo ayudándote con eso sin problema.`,
            `${namePrefix}quedo pendiente por si quieres que te lo deje más claro o te diga el siguiente paso.`,
          ]
        : [
            `${namePrefix}si aún te interesa, dime y te ayudo rápido con eso 🙌`,
            `${namePrefix}si quieres retomamos eso cuando te quede cómodo y te ayudo de una.`,
            `${namePrefix}aquí estoy por si todavía quieres resolverlo rápido.`,
          ];

    return (
      variants.find((item) => !this.wasRecentlyRepeated(item, followup, memoryContext.messages)) ??
      variants[0]
    );
  }

  private shouldSuppressFollowup(
    clientMemory: ClientMemorySnapshot,
    messages: StoredMessage[],
  ): boolean {
    if (clientMemory.status === 'cliente') {
      return true;
    }

    const recentUserMessages = messages
      .filter((item) => item.role === 'user')
      .slice(-4)
      .map((item) => item.content.toLowerCase());

    return recentUserMessages.some((message) =>
      [
        'no me interesa',
        'no gracias',
        'ya compre',
        'ya compré',
        'despues',
        'después',
        'mas tarde',
        'más tarde',
        'yo te aviso',
        'te aviso',
        'luego te escribo',
        'te escribo luego',
        'lo dejamos asi',
        'lo dejamos así',
        'dejalo asi',
        'déjalo así',
        'cerrado',
        'listo gracias',
      ].some((keyword) => message.includes(keyword)),
    );
  }

  private async sendFollowupText(outboundAddress: string, text: string): Promise<void> {
    const config = await this.clientConfigService.getConfig();
    const apiBaseUrl = config.whatsappSettings?.apiBaseUrl?.trim() || '';
    const apiKey = config.whatsappSettings?.apiKey?.trim() || '';
    const instanceName = config.whatsappSettings?.instanceName?.trim() || '';

    if (!apiBaseUrl || !apiKey || !instanceName) {
      throw new Error('WhatsApp followup config is incomplete');
    }

    await axios.post(
      `${apiBaseUrl.replace(/\/+$/, '')}/message/sendText/${instanceName}`,
      {
        number: outboundAddress,
        text,
      },
      {
        headers: {
          apikey: apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );
  }

  private computeNextFollowupAt(
    currentStep: number,
    baseDate: Date,
    config: FollowupConfig,
  ): Date | null {
    if (currentStep >= config.maxFollowups) {
      return null;
    }

    if (currentStep === 0) {
      return new Date(baseDate.getTime() + config.followup1DelayMinutes * 60 * 1000);
    }

    if (currentStep === 1) {
      return new Date(baseDate.getTime() + config.followup2DelayMinutes * 60 * 1000);
    }

    if (currentStep === 2) {
      return new Date(baseDate.getTime() + config.followup3DelayHours * 60 * 60 * 1000);
    }

    return null;
  }

  private normalizeContactId(contactId: string): string {
    const normalized = contactId.trim();
    if (!normalized) {
      throw new Error('contactId is required');
    }
    return normalized;
  }

  private normalizeOutboundAddress(outboundAddress: string | null | undefined, contactId: string): string {
    const normalized = outboundAddress?.trim().toLowerCase() || '';
    if (normalized.includes('@s.whatsapp.net')) {
      return normalized;
    }

    return `${contactId.replace(/\D+/g, '')}@s.whatsapp.net`;
  }

  private async getFollowupConfig(): Promise<FollowupConfig> {
    const config = await this.clientConfigService.getConfig();
    const settings = config.botSettings;

    return {
      enabled: settings?.followupEnabled ?? false,
      followup1DelayMinutes: Math.max(settings?.followup1DelayMinutes ?? 10, 1),
      followup2DelayMinutes: Math.max(settings?.followup2DelayMinutes ?? 30, 1),
      followup3DelayHours: Math.max(settings?.followup3DelayHours ?? 24, 1),
      maxFollowups: Math.min(Math.max(settings?.maxFollowups ?? 3, 1), 3),
      stopIfUserReply: settings?.stopIfUserReply ?? true,
    };
  }

  private async deactivate(contactId: string, reason: string): Promise<void> {
    await this.prisma.conversationFollowup.updateMany({
      where: { contactId },
      data: {
        isActive: false,
        nextFollowupAt: null,
      },
    });

    this.logger.log(
      JSON.stringify({
        event: 'followup_deactivated',
        contactId,
        reason,
      }),
    );
  }

  private toFollowupSnapshot(contactId: string, followup: ConversationFollowup | null) {
    return {
      contactId,
      outboundAddress: followup?.outboundAddress ?? null,
      lastMessageFrom: followup?.lastMessageFrom ?? null,
      lastMessageAt: followup?.lastMessageAt?.toISOString() ?? null,
      followupStep: followup?.followupStep ?? 0,
      isActive: followup?.isActive ?? false,
      nextFollowupAt: followup?.nextFollowupAt?.toISOString() ?? null,
      lastFollowupMessage: followup?.lastFollowupMessage ?? null,
      updatedAt: followup?.updatedAt?.toISOString() ?? null,
    };
  }

  private normalizeComparable(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }
}
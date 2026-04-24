import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientMemory, ConversationSummary } from '@prisma/client';
import OpenAI from 'openai';
import { ClientConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  ClientInterest,
  ClientMemorySnapshot,
  ClientObjective,
  ClientStatus,
  ConversationContextSnapshot,
  ConversationRole,
  ConversationSummarySnapshot,
  MemoryContactListItem,
  StoredMessage,
  UpdateMemoryEntryInput,
} from './memory.types';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private static readonly SHORT_MEMORY_LIMIT = 20;
  private static readonly SHORT_MEMORY_TTL_SECONDS = 60 * 60 * 24;
  private static readonly LONG_MEMORY_TTL_DAYS = 15;
  private static readonly LONG_MEMORY_TTL_SECONDS = 60 * 60 * 24 * 15;
  private static readonly SUMMARY_REFRESH_INTERVAL = 5;
  private static readonly MAX_SUMMARY_CHARS = 2048;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly clientConfigService: ClientConfigService,
  ) {}

  async saveMessage(params: {
    contactId: string;
    role: ConversationRole;
    content: string;
  }): Promise<StoredMessage> {
    const contactId = this.normalizeContactId(params.contactId);
    const content = params.content.trim();

    if (!content) {
      throw new BadRequestException('content is required');
    }

    const message: StoredMessage = {
      role: params.role,
      content,
      createdAt: new Date(),
    };

    const recentMessages = await this.redisService.appendConversationMessage(
      contactId,
      message,
      MemoryService.SHORT_MEMORY_LIMIT,
      MemoryService.SHORT_MEMORY_TTL_SECONDS,
    );

    if (params.role === 'user') {
      await this.touchLongMemoryExpiry(contactId);
      await this.updateClientMemory(contactId, content, recentMessages);

      const messageCount = await this.redisService.increment(
        this.getSummaryCounterKey(contactId),
        MemoryService.LONG_MEMORY_TTL_SECONDS,
      );

      if (messageCount % MemoryService.SUMMARY_REFRESH_INTERVAL === 0) {
        await this.updateSummary(contactId, recentMessages);
      }
    }

    return message;
  }

  async getRecentMessages(contactId: string, limit = 10): Promise<StoredMessage[]> {
    const normalizedContactId = this.normalizeContactId(contactId);

    try {
      const cachedMessages = await this.redisService.getConversationMessages(normalizedContactId, limit);
      if (cachedMessages.length > 0) {
        return cachedMessages.slice(-limit);
      }
    } catch (error) {
      this.logger.warn(
        `Redis recent message lookup failed for ${normalizedContactId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    const messages = await this.prisma.conversationMessage.findMany({
      where: { contactId: normalizedContactId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        role: true,
        content: true,
        createdAt: true,
      },
    });

    const normalizedMessages = messages.reverse().map((message) => ({
      role: message.role as ConversationRole,
      content: message.content,
      createdAt: message.createdAt,
    }));

    await this.safePrimeRedis(normalizedContactId, normalizedMessages);
    return normalizedMessages;
  }

  async getClientMemory(contactId: string): Promise<ClientMemorySnapshot> {
    const normalizedContactId = this.normalizeContactId(contactId);
    const memory = await this.prisma.clientMemory.findUnique({
      where: { contactId: normalizedContactId },
    });

    if (memory?.expiresAt && memory.expiresAt.getTime() <= Date.now()) {
      await this.prisma.clientMemory.deleteMany({ where: { contactId: normalizedContactId } });
      return this.toClientMemorySnapshot(normalizedContactId, null);
    }

    return this.toClientMemorySnapshot(normalizedContactId, memory);
  }

  async getSummary(contactId: string): Promise<ConversationSummarySnapshot> {
    const normalizedContactId = this.normalizeContactId(contactId);
    const summary = await this.prisma.conversationSummary.findUnique({
      where: { contactId: normalizedContactId },
    });

    if (summary?.expiresAt && summary.expiresAt.getTime() <= Date.now()) {
      await this.prisma.conversationSummary.deleteMany({ where: { contactId: normalizedContactId } });
      return this.toSummarySnapshot(normalizedContactId, null);
    }

    return this.toSummarySnapshot(normalizedContactId, summary);
  }

  async getConversationContext(
    contactId: string,
    limit = 10,
  ): Promise<ConversationContextSnapshot> {
    const normalizedContactId = this.normalizeContactId(contactId);
    const [messages, clientMemory, summary] = await Promise.all([
      this.getRecentMessages(normalizedContactId, limit),
      this.getClientMemory(normalizedContactId),
      this.getSummary(normalizedContactId),
    ]);

    return {
      messages,
      clientMemory,
      summary,
    };
  }

  async listContacts(query?: string): Promise<MemoryContactListItem[]> {
    const normalizedQuery = query?.trim().toLowerCase() ?? '';
    const now = new Date();
    const [messageGroups, memories, summaries] = await Promise.all([
      this.prisma.conversationMessage.groupBy({
        by: ['contactId'],
        _max: { createdAt: true },
        orderBy: {
          _max: { createdAt: 'desc' },
        },
        take: 100,
      }),
      this.prisma.clientMemory.findMany({
        where: { expiresAt: { gt: now } },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      this.prisma.conversationSummary.findMany({
        where: { expiresAt: { gt: now } },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    ]);

    const memoryByContact = new Map(memories.map((item) => [item.contactId, item]));
    const summaryByContact = new Map(summaries.map((item) => [item.contactId, item]));
    const messageByContact = new Map(
      messageGroups.map((item) => [item.contactId, item._max.createdAt ?? null]),
    );

    const contactIds = new Set<string>([
      ...messageByContact.keys(),
      ...memoryByContact.keys(),
      ...summaryByContact.keys(),
    ]);

    const items = Array.from(contactIds)
      .map((contactId) => {
        const memory = memoryByContact.get(contactId as string) ?? null;
        const summary = summaryByContact.get(contactId as string) ?? null;
        const lastMessageAt = messageByContact.get(contactId as string) ?? null;

        return {
          contactId: contactId as string,
          name: memory?.name ?? null,
          objective: this.normalizeObjective(memory?.objective ?? null),
          interest: memory?.interest ?? null,
          status: this.normalizeStatus(memory?.status ?? null),
          lastIntent: this.buildLegacyIntent(memory),
          summary: summary?.summary ?? null,
          lastMessageAt,
          memoryUpdatedAt: memory?.updatedAt ?? null,
          summaryUpdatedAt: summary?.updatedAt ?? null,
        } as MemoryContactListItem;
      })
      .filter((item) => {
        if (!normalizedQuery) {
          return true;
        }

        const haystack = [
          item.contactId,
          item.name,
          item.objective,
          item.interest,
          item.status,
          item.lastIntent,
          item.summary,
        ]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join(' ')
          .toLowerCase();

        return haystack.includes(normalizedQuery);
      });

    items.sort((left, right) => {
      const leftTime = this.getLatestTimestamp([
        left.lastMessageAt,
        left.memoryUpdatedAt,
        left.summaryUpdatedAt,
      ]);
      const rightTime = this.getLatestTimestamp([
        right.lastMessageAt,
        right.memoryUpdatedAt,
        right.summaryUpdatedAt,
      ]);

      if (leftTime === null && rightTime === null) {
        return left.contactId.localeCompare(right.contactId);
      }

      if (leftTime === null) {
        return 1;
      }

      if (rightTime === null) {
        return -1;
      }

      return rightTime.getTime() - leftTime.getTime();
    });

    return items;
  }

  async updateMemoryEntry(
    contactId: string,
    input: UpdateMemoryEntryInput,
  ): Promise<ConversationContextSnapshot> {
    const normalizedContactId = this.normalizeContactId(contactId);

    const objective = this.normalizeObjective(input.objective ?? input.lastIntent ?? null);
    const interest = this.normalizeInterest(input.interest);
    const objections = this.normalizeObjections(input.objections ?? this.parseLegacyNotes(input.notes));
    const status = this.normalizeStatus(input.status ?? this.deriveStatusFromLegacyIntent(input.lastIntent));

    const memory = await this.prisma.clientMemory.upsert({
      where: { contactId: normalizedContactId },
      create: {
        contactId: normalizedContactId,
        name: this.normalizeOptionalText(input.name),
        objective,
        interest,
        objections,
        status,
        lastIntent: this.normalizeOptionalText(input.lastIntent),
        notes: this.normalizeOptionalText(input.notes),
        expiresAt: this.buildLongMemoryExpiry(),
      },
      update: {
        name: this.normalizeOptionalText(input.name),
        objective,
        interest,
        objections,
        status,
        lastIntent: this.normalizeOptionalText(input.lastIntent),
        notes: this.normalizeOptionalText(input.notes),
        expiresAt: this.buildLongMemoryExpiry(),
      },
    });

    const summaryText = this.normalizeOptionalText(input.summary);
    if (summaryText != null) {
      await this.prisma.conversationSummary.upsert({
        where: { contactId: normalizedContactId },
        create: {
          contactId: normalizedContactId,
          summary: this.truncateSummary(summaryText),
          expiresAt: this.buildLongMemoryExpiry(),
        },
        update: {
          summary: this.truncateSummary(summaryText),
          expiresAt: this.buildLongMemoryExpiry(),
        },
      });
    }

    if (summaryText == null) {
      await this.prisma.conversationSummary.deleteMany({ where: { contactId: normalizedContactId } });
    }

    return {
      messages: await this.getRecentMessages(normalizedContactId),
      clientMemory: this.toClientMemorySnapshot(normalizedContactId, memory),
      summary: await this.getSummary(normalizedContactId),
    };
  }

  async updateClientMemory(
    contactId: string,
    text: string,
    recentMessages?: StoredMessage[],
  ): Promise<ClientMemorySnapshot> {
    const normalizedContactId = this.normalizeContactId(contactId);
    const normalizedText = text.trim();
    const shortMemory = recentMessages ?? await this.getRecentMessages(normalizedContactId);

    const current = await this.prisma.clientMemory.findUnique({
      where: { contactId: normalizedContactId },
    });

    if (!this.shouldStoreProfileSignal(normalizedText, shortMemory)) {
      return this.toClientMemorySnapshot(normalizedContactId, current);
    }

    const extracted = this.extractProfileSignal(normalizedText);
    const mergedObjections = this.mergeObjections(
      this.readObjections(current?.objections),
      extracted.objections,
    );

    const detectedName = extracted.name ?? current?.name ?? null;
    const detectedObjective = extracted.objective ?? this.normalizeObjective(current?.objective ?? null);
    const detectedInterest = extracted.interest ?? this.normalizeInterest(current?.interest);
    const detectedStatus = this.resolveStatus(current?.status ?? null, extracted.status);
    const legacyIntent = this.buildLegacyIntent({
      objective: detectedObjective,
      interest: detectedInterest,
      status: detectedStatus,
      lastIntent: current?.lastIntent ?? null,
    });
    const legacyNotes = mergedObjections.length > 0 ? mergedObjections.join(' | ') : null;

    const memory = await this.prisma.clientMemory.upsert({
      where: { contactId: normalizedContactId },
      create: {
        contactId: normalizedContactId,
        name: detectedName,
        objective: detectedObjective,
        interest: detectedInterest,
        objections: mergedObjections,
        status: detectedStatus,
        lastIntent: legacyIntent,
        notes: legacyNotes,
        expiresAt: this.buildLongMemoryExpiry(),
      },
      update: {
        name: detectedName,
        objective: detectedObjective,
        interest: detectedInterest,
        objections: mergedObjections,
        status: detectedStatus,
        lastIntent: legacyIntent,
        notes: legacyNotes,
        expiresAt: this.buildLongMemoryExpiry(),
      },
    });

    return this.toClientMemorySnapshot(normalizedContactId, memory);
  }

  async updateSummary(
    contactId: string,
    recentMessages?: StoredMessage[],
  ): Promise<ConversationSummarySnapshot> {
    const normalizedContactId = this.normalizeContactId(contactId);
    const [messages, clientMemory, currentSummary] = await Promise.all([
      recentMessages
        ? Promise.resolve(recentMessages)
        : this.getRecentMessages(normalizedContactId, MemoryService.SHORT_MEMORY_LIMIT),
      this.getClientMemory(normalizedContactId),
      this.getSummary(normalizedContactId),
    ]);

    const summaryText = await this.generateSummaryText(
      normalizedContactId,
      messages,
      clientMemory,
      currentSummary.summary,
    );

    const summary = await this.prisma.conversationSummary.upsert({
      where: { contactId: normalizedContactId },
      create: {
        contactId: normalizedContactId,
        summary: this.truncateSummary(summaryText),
        expiresAt: this.buildLongMemoryExpiry(),
      },
      update: {
        summary: this.truncateSummary(summaryText),
        expiresAt: this.buildLongMemoryExpiry(),
      },
    });

    return this.toSummarySnapshot(normalizedContactId, summary);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredMemory(): Promise<void> {
    const now = new Date();
    const threshold = new Date(
      now.getTime() - MemoryService.LONG_MEMORY_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    const [expiredProfiles, expiredSummaries, oldMessages] = await Promise.all([
      this.prisma.clientMemory.deleteMany({ where: { expiresAt: { lte: now } } }),
      this.prisma.conversationSummary.deleteMany({ where: { expiresAt: { lte: now } } }),
      this.prisma.conversationMessage.deleteMany({ where: { createdAt: { lt: threshold } } }),
    ]);

    this.logger.log(
      JSON.stringify({
        event: 'memory_cleanup_completed',
        deletedProfiles: expiredProfiles.count,
        deletedSummaries: expiredSummaries.count,
        deletedOldMessages: oldMessages.count,
      }),
    );
  }

  private async safePrimeRedis(contactId: string, messages: StoredMessage[]): Promise<void> {
    try {
      await this.redisService.setConversationMessages(
        contactId,
        messages,
        MemoryService.SHORT_MEMORY_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Redis conversation prime failed for ${contactId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  private async generateSummaryText(
    contactId: string,
    messages: StoredMessage[],
    clientMemory: ClientMemorySnapshot,
    previousSummary: string | null,
  ): Promise<string> {
    const relevantMessages = this.filterSummaryMessages(messages);
    if (relevantMessages.length === 0) {
      return this.buildFallbackSummary(contactId, messages, clientMemory, previousSummary);
    }

    const config = await this.clientConfigService.getConfig();
    if (!config.openaiKey.trim()) {
      return this.buildFallbackSummary(contactId, messages, clientMemory, previousSummary);
    }

    try {
      const openai = new OpenAI({ apiKey: config.openaiKey });
      const modelName = config.aiSettings?.modelName || 'gpt-4o-mini';
      const response = await openai.chat.completions.create({
        model: modelName,
        temperature: 0.2,
        max_completion_tokens: 220,
        messages: [
          {
            role: 'system',
            content:
              'Resume conversaciones de ventas por WhatsApp en menos de 2KB. Devuelve un resumen util para continuar la conversacion sin repetir preguntas. Incluye objetivo, interes, objeciones y proximo paso si aplica.',
          },
          {
            role: 'user',
            content: [
              `Contacto: ${contactId}`,
              `Nombre recordado: ${clientMemory.name ?? 'N/D'}`,
              `Objetivo recordado: ${clientMemory.objective ?? 'N/D'}`,
              `Interes recordado: ${clientMemory.interest ?? 'N/D'}`,
              `Objeciones recordadas: ${clientMemory.objections.join(' | ') || 'N/D'}`,
              `Estado del cliente: ${clientMemory.status}`,
              `Resumen anterior: ${previousSummary ?? 'N/D'}`,
              'Mensajes recientes:',
              ...relevantMessages.map((message) => `${message.role}: ${message.content}`),
            ].join('\n'),
          },
        ],
      });

      const summary = response.choices[0]?.message?.content?.trim();
      if (summary) {
        return this.truncateSummary(summary);
      }
    } catch (error) {
      this.logger.warn(
        `Summary generation failed for ${contactId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    return this.buildFallbackSummary(contactId, messages, clientMemory, previousSummary);
  }

  private buildFallbackSummary(
    contactId: string,
    messages: StoredMessage[],
    clientMemory: ClientMemorySnapshot,
    previousSummary: string | null,
  ): string {
    const lastLines = this.filterSummaryMessages(messages)
      .slice(-6)
      .map((message) => `${message.role}: ${message.content}`);

    return this.truncateSummary(
      [
        `Contacto: ${contactId}`,
        `Nombre: ${clientMemory.name ?? 'No identificado'}`,
        `Objetivo: ${clientMemory.objective ?? 'Sin objetivo claro'}`,
        `Interes: ${clientMemory.interest ?? 'Sin interes claro todavia'}`,
        `Objeciones: ${clientMemory.objections.join(', ') || 'Sin objeciones detectadas'}`,
        `Estado: ${clientMemory.status}`,
        previousSummary ? `Resumen previo: ${previousSummary}` : null,
        `Historial reciente: ${lastLines.join(' | ')}`,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
    );
  }

  private shouldStoreProfileSignal(text: string, recentMessages: StoredMessage[]): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized || this.isNoiseMessage(normalized)) {
      return false;
    }

    const previousUserMessage = [...recentMessages]
      .reverse()
      .slice(1)
      .find((message) => message.role === 'user');

    if (previousUserMessage?.content.trim().toLowerCase() === normalized) {
      return false;
    }

    const extracted = this.extractProfileSignal(text);
    return Boolean(
      extracted.name ||
        extracted.objective ||
        extracted.interest ||
        extracted.objections.length > 0 ||
        extracted.status,
    );
  }

  private isNoiseMessage(normalized: string): boolean {
    if (normalized.length < 2) {
      return true;
    }

    return ['hola', 'buenas', 'buen dia', 'buenos dias', 'ok', 'gracias', 'dale', '👍', '🙏'].includes(normalized);
  }

  private extractProfileSignal(text: string): {
    name: string | null;
    objective: ClientObjective | null;
    interest: ClientInterest | null;
    objections: string[];
    status: ClientStatus | null;
  } {
    const normalized = text.toLowerCase();

    return {
      name: this.extractName(text),
      objective: this.extractObjective(normalized),
      interest: this.extractInterest(normalized),
      objections: this.extractObjections(text),
      status: this.extractStatus(normalized),
    };
  }

  private extractName(text: string): string | null {
    const patterns = [
      /(?:me llamo|mi nombre es)\s+([A-Za-zÁÉÍÓÚáéíóúÑñÜü' -]{2,60})/i,
      /(?:soy)\s+([A-Za-zÁÉÍÓÚáéíóúÑñÜü' -]{2,60})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = match?.[1]?.trim();
      if (value) {
        return this.capitalizeWords(value.replace(/[.,;!?]+$/, ''));
      }
    }

    return null;
  }

  private extractObjective(normalized: string): ClientObjective | null {
    if (
      ['rebajar', 'bajar de peso', 'perder peso', 'adelgazar', 'rebajar rapido', 'rebajar rápido']
        .some((keyword) => normalized.includes(keyword))
    ) {
      return 'rebajar';
    }

    if (
      ['comprar', 'pedido', 'ordenar', 'lo quiero', 'como compro', 'cómo compro', 'me lo llevo']
        .some((keyword) => normalized.includes(keyword))
    ) {
      return 'comprar';
    }

    if (
      ['precio', 'cuanto cuesta', 'cuánto cuesta', 'info', 'informacion', 'información', 'quiero saber', 'explicame', 'explícame', 'dime']
        .some((keyword) => normalized.includes(keyword))
    ) {
      return 'info';
    }

    return null;
  }

  private extractInterest(normalized: string): ClientInterest | null {
    if (
      ['precio', 'cuanto cuesta', 'cuánto cuesta', 'vale', 'costo', 'cuesta']
        .some((keyword) => normalized.includes(keyword))
    ) {
      return 'precio';
    }

    if (
      ['resultado', 'resultados', 'antes y despues', 'antes y después', 'testimonio', 'testimonios']
        .some((keyword) => normalized.includes(keyword))
    ) {
      return 'resultados';
    }

    if (
      ['funciona', 'sirve', 'seguro', 'garantia', 'garantía', 'duda', 'dudas', 'no creo']
        .some((keyword) => normalized.includes(keyword))
    ) {
      return 'dudas';
    }

    return null;
  }

  private extractObjections(text: string): string[] {
    const normalized = text.trim().toLowerCase();
    const objections = new Set<string>();

    for (const phrase of [
      'no tengo dinero',
      'no tengo cuarto',
      'no creo',
      'esta caro',
      'está caro',
      'muy caro',
      'no me da confianza',
    ]) {
      if (normalized.includes(phrase)) {
        objections.add(phrase);
      }
    }

    if (['funciona', 'sirve', 'resultado', 'resultados'].some((keyword) => normalized.includes(keyword))) {
      objections.add('tiene dudas sobre resultados');
    }

    return Array.from(objections);
  }

  private extractStatus(normalized: string): ClientStatus | null {
    if (
      ['ya compre', 'ya compré', 'ya pague', 'ya pagué', 'soy cliente', 'me llego', 'me llegó']
        .some((keyword) => normalized.includes(keyword))
    ) {
      return 'cliente';
    }

    if (
      ['precio', 'cuanto cuesta', 'cuánto cuesta', 'lo quiero', 'comprar', 'pedido', 'resultado', 'funciona']
        .some((keyword) => normalized.includes(keyword))
    ) {
      return 'interesado';
    }

    return null;
  }

  private readObjections(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private mergeObjections(current: string[], next: string[]): string[] {
    return Array.from(new Set([...current, ...next])).slice(0, 6);
  }

  private filterSummaryMessages(messages: StoredMessage[]): StoredMessage[] {
    return messages.filter((message) => !this.isNoiseMessage(message.content.trim().toLowerCase()));
  }

  private truncateSummary(summary: string): string {
    const trimmed = summary.trim();
    if (trimmed.length <= MemoryService.MAX_SUMMARY_CHARS) {
      return trimmed;
    }

    return `${trimmed.slice(0, MemoryService.MAX_SUMMARY_CHARS - 3).trimEnd()}...`;
  }

  private buildLongMemoryExpiry(): Date {
    return new Date(Date.now() + MemoryService.LONG_MEMORY_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  private async touchLongMemoryExpiry(contactId: string): Promise<void> {
    const expiresAt = this.buildLongMemoryExpiry();

    await Promise.all([
      this.prisma.clientMemory.updateMany({ where: { contactId }, data: { expiresAt } }),
      this.prisma.conversationSummary.updateMany({ where: { contactId }, data: { expiresAt } }),
    ]);
  }

  private getSummaryCounterKey(contactId: string): string {
    return `memory:summary-count:${contactId}`;
  }

  private capitalizeWords(value: string): string {
    return value
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private toClientMemorySnapshot(
    contactId: string,
    memory: ClientMemory | null,
  ): ClientMemorySnapshot {
    return {
      contactId,
      name: memory?.name ?? null,
      objective: this.normalizeObjective(memory?.objective ?? null),
      interest: this.normalizeInterest(memory?.interest),
      objections: this.readObjections(memory?.objections),
      status: this.normalizeStatus(memory?.status ?? null),
      lastIntent: this.buildLegacyIntent(memory),
      notes: this.buildLegacyNotes(memory),
      updatedAt: memory?.updatedAt ?? null,
      expiresAt: memory?.expiresAt ?? null,
    };
  }

  private toSummarySnapshot(
    contactId: string,
    summary: ConversationSummary | null,
  ): ConversationSummarySnapshot {
    return {
      contactId,
      summary: summary?.summary ?? null,
      updatedAt: summary?.updatedAt ?? null,
      expiresAt: summary?.expiresAt ?? null,
    };
  }

  private normalizeContactId(contactId: string): string {
    const normalizedContactId = contactId.trim();

    if (!normalizedContactId) {
      throw new BadRequestException('contactId is required');
    }

    return normalizedContactId;
  }

  private normalizeOptionalText(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized.length === 0 ? null : normalized;
  }

  private normalizeObjective(value: string | null | undefined): ClientObjective | null {
    if (!value) {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'rebajar') {
      return 'rebajar';
    }
    if (normalized === 'info' || normalized === 'informacion' || normalized === 'información') {
      return 'info';
    }
    if (normalized === 'comprar' || normalized === 'compra') {
      return 'comprar';
    }

    return null;
  }

  private normalizeInterest(value: string | null | undefined): ClientInterest | null {
    if (!value) {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'precio') {
      return 'precio';
    }
    if (normalized === 'resultado' || normalized === 'resultados') {
      return 'resultados';
    }
    if (normalized === 'duda' || normalized === 'dudas') {
      return 'dudas';
    }

    return null;
  }

  private normalizeStatus(value: string | null | undefined): ClientStatus {
    if (!value) {
      return 'nuevo';
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'cliente') {
      return 'cliente';
    }
    if (normalized === 'interesado') {
      return 'interesado';
    }

    return 'nuevo';
  }

  private normalizeObjections(value: string[] | null | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
    ).slice(0, 6);
  }

  private buildLegacyIntent(memory: {
    objective?: string | null;
    interest?: string | null;
    status?: string | null;
    lastIntent?: string | null;
  } | null): string | null {
    if (memory?.lastIntent?.trim()) {
      return memory.lastIntent.trim();
    }

    if (this.normalizeStatus(memory?.status ?? null) === 'cliente') {
      return 'compra';
    }
    if (this.normalizeObjective(memory?.objective ?? null) === 'comprar') {
      return 'HOT';
    }
    if (this.normalizeInterest(memory?.interest) === 'precio') {
      return 'consulta_precio';
    }
    if (['resultados', 'dudas'].includes(this.normalizeInterest(memory?.interest) ?? '')) {
      return 'duda';
    }
    if (this.normalizeObjective(memory?.objective ?? null) === 'info') {
      return 'consulta_informacion';
    }

    return null;
  }

  private buildLegacyNotes(memory: Pick<ClientMemory, 'objections' | 'notes'> | null): string | null {
    if (memory?.notes?.trim()) {
      return memory.notes.trim();
    }

    const objections = this.readObjections(memory?.objections);
    return objections.length > 0 ? objections.join(' | ') : null;
  }

  private resolveStatus(
    currentStatus: string | null | undefined,
    nextStatus: ClientStatus | null,
  ): ClientStatus {
    const current = this.normalizeStatus(currentStatus);
    if (current === 'cliente' || nextStatus === 'cliente') {
      return 'cliente';
    }
    if (current === 'interesado' || nextStatus === 'interesado') {
      return 'interesado';
    }

    return 'nuevo';
  }

  private parseLegacyNotes(notes: string | null | undefined): string[] {
    if (!notes?.trim()) {
      return [];
    }

    return notes
      .split('|')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private deriveStatusFromLegacyIntent(lastIntent: string | null | undefined): ClientStatus | null {
    const normalized = lastIntent?.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (normalized === 'cliente') {
      return 'cliente';
    }
    if (normalized === 'hot' || normalized === 'compra' || normalized === 'consulta_precio') {
      return 'interesado';
    }

    return 'nuevo';
  }

  private getLatestTimestamp(values: Array<Date | null>): Date | null {
    return values.reduce<Date | null>((latest, value) => {
      if (value === null) {
        return latest;
      }

      if (latest === null || value.getTime() > latest.getTime()) {
        return value;
      }

      return latest;
    }, null);
  }
}
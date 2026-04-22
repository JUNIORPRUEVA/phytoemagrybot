import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  ClientMemory,
  ConversationMessage,
  ConversationSummary,
} from '@prisma/client';
import { ClientConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  ClientMemorySnapshot,
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly clientConfigService: ClientConfigService,
  ) {}

  async saveMessage(params: {
    contactId: string;
    role: ConversationRole;
    content: string;
  }): Promise<ConversationMessage> {
    const contactId = params.contactId.trim();
    const content = params.content.trim();

    if (!contactId) {
      throw new BadRequestException('contactId is required');
    }

    if (!content) {
      throw new BadRequestException('content is required');
    }

    const message = await this.prisma.conversationMessage.create({
      data: {
        contactId,
        role: params.role,
        content,
      },
    });

    await this.syncRedisConversation(contactId);

    if (params.role === 'user') {
      await this.updateClientMemory(contactId, content);
    }

    const messageCount = await this.prisma.conversationMessage.count({
      where: { contactId },
    });

    if (messageCount > 0 && messageCount % 10 === 0) {
      await this.updateSummary(contactId);
    }

    return message;
  }

  async getRecentMessages(contactId: string, limit = 10): Promise<StoredMessage[]> {
    const normalizedContactId = contactId.trim();

    if (!normalizedContactId) {
      throw new BadRequestException('contactId is required');
    }

    try {
      const cachedMessages = await this.redisService.getConversationMessages(
        normalizedContactId,
        limit,
      );

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

    return this.toClientMemorySnapshot(normalizedContactId, memory);
  }

  async getSummary(contactId: string): Promise<ConversationSummarySnapshot> {
    const normalizedContactId = this.normalizeContactId(contactId);
    const summary = await this.prisma.conversationSummary.findUnique({
      where: { contactId: normalizedContactId },
    });

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
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      this.prisma.conversationSummary.findMany({
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
          interest: memory?.interest ?? null,
          lastIntent: memory?.lastIntent ?? null,
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
          item.interest,
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

    const memory = await this.prisma.clientMemory.upsert({
      where: { contactId: normalizedContactId },
      create: {
        contactId: normalizedContactId,
        name: this.normalizeOptionalText(input.name),
        interest: this.normalizeOptionalText(input.interest),
        lastIntent: this.normalizeOptionalText(input.lastIntent),
        notes: this.normalizeOptionalText(input.notes),
      },
      update: {
        name: this.normalizeOptionalText(input.name),
        interest: this.normalizeOptionalText(input.interest),
        lastIntent: this.normalizeOptionalText(input.lastIntent),
        notes: this.normalizeOptionalText(input.notes),
      },
    });

    const summaryText = this.normalizeOptionalText(input.summary);
    if (summaryText != null) {
      await this.prisma.conversationSummary.upsert({
        where: { contactId: normalizedContactId },
        create: {
          contactId: normalizedContactId,
          summary: summaryText,
        },
        update: {
          summary: summaryText,
        },
      });
    }

    if (summaryText == null) {
      await this.prisma.conversationSummary.deleteMany({
        where: { contactId: normalizedContactId },
      });
    }

    return {
      messages: await this.getRecentMessages(normalizedContactId),
      clientMemory: this.toClientMemorySnapshot(normalizedContactId, memory),
      summary: await this.getSummary(normalizedContactId),
    };
  }

  async updateClientMemory(contactId: string, text: string): Promise<ClientMemorySnapshot> {
    const normalizedContactId = this.normalizeContactId(contactId);
    const normalizedText = text.trim();
    const current = await this.prisma.clientMemory.findUnique({
      where: { contactId: normalizedContactId },
    });

    const detectedName = this.extractName(normalizedText) ?? current?.name ?? null;
    const detectedInterest = this.extractInterest(normalizedText) ?? current?.interest ?? null;
    const detectedIntent = this.resolveIntent(current?.lastIntent ?? null, normalizedText);
    const mergedNotes = this.mergeNotes(current?.notes ?? null, this.extractNote(normalizedText));

    const memory = await this.prisma.clientMemory.upsert({
      where: { contactId: normalizedContactId },
      create: {
        contactId: normalizedContactId,
        name: detectedName,
        interest: detectedInterest,
        lastIntent: detectedIntent,
        notes: mergedNotes,
      },
      update: {
        name: detectedName,
        interest: detectedInterest,
        lastIntent: detectedIntent,
        notes: mergedNotes,
      },
    });

    return this.toClientMemorySnapshot(normalizedContactId, memory);
  }

  async updateSummary(contactId: string): Promise<ConversationSummarySnapshot> {
    const normalizedContactId = this.normalizeContactId(contactId);
    const [messages, clientMemory] = await Promise.all([
      this.prisma.conversationMessage.findMany({
        where: { contactId: normalizedContactId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.getClientMemory(normalizedContactId),
    ]);

    const orderedMessages = messages.reverse();
    const summaryText = await this.generateSummaryText(normalizedContactId, orderedMessages, clientMemory);

    const summary = await this.prisma.conversationSummary.upsert({
      where: { contactId: normalizedContactId },
      create: {
        contactId: normalizedContactId,
        summary: summaryText,
      },
      update: {
        summary: summaryText,
      },
    });

    return this.toSummarySnapshot(normalizedContactId, summary);
  }

  private async syncRedisConversation(contactId: string): Promise<void> {
    try {
      const latestMessages = await this.prisma.conversationMessage.findMany({
        where: { contactId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      await this.redisService.setConversationMessages(
        contactId,
        latestMessages.reverse().map((message) => ({
          role: message.role as ConversationRole,
          content: message.content,
          createdAt: message.createdAt,
        })),
      );
    } catch (error) {
      this.logger.warn(
        `Redis conversation sync failed for ${contactId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  private async safePrimeRedis(contactId: string, messages: StoredMessage[]): Promise<void> {
    try {
      await this.redisService.setConversationMessages(contactId, messages);
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
    messages: ConversationMessage[],
    clientMemory: ClientMemorySnapshot,
  ): Promise<string> {
    if (messages.length === 0) {
      return this.buildFallbackSummary(contactId, messages, clientMemory);
    }

    const config = await this.clientConfigService.getConfig();
    if (!config.openaiKey.trim()) {
      return this.buildFallbackSummary(contactId, messages, clientMemory);
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
              'Resume conversaciones de ventas por WhatsApp. Devuelve un resumen corto y util para continuar la conversacion sin repetir preguntas. Incluye nombre, interes, intencion y proximos pasos si existen.',
          },
          {
            role: 'user',
            content: [
              `Contacto: ${contactId}`,
              `Nombre recordado: ${clientMemory.name ?? 'N/D'}`,
              `Interes recordado: ${clientMemory.interest ?? 'N/D'}`,
              `Ultima intencion: ${clientMemory.lastIntent ?? 'N/D'}`,
              `Notas: ${clientMemory.notes ?? 'N/D'}`,
              'Mensajes recientes:',
              ...messages.map((message) => `${message.role}: ${message.content}`),
            ].join('\n'),
          },
        ],
      });

      const summary = response.choices[0]?.message?.content?.trim();
      if (summary) {
        return summary;
      }
    } catch (error) {
      this.logger.warn(
        `Summary generation failed for ${contactId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    return this.buildFallbackSummary(contactId, messages, clientMemory);
  }

  private buildFallbackSummary(
    contactId: string,
    messages: ConversationMessage[],
    clientMemory: ClientMemorySnapshot,
  ): string {
    const lastLines = messages.slice(-6).map((message) => `${message.role}: ${message.content}`);
    return [
      `Contacto: ${contactId}`,
      `Nombre: ${clientMemory.name ?? 'No identificado'}`,
      `Interes: ${clientMemory.interest ?? 'Sin interes claro todavia'}`,
      `Ultima intencion: ${clientMemory.lastIntent ?? 'Sin intencion detectada'}`,
      `Notas: ${clientMemory.notes ?? 'Sin notas'}`,
      `Historial reciente: ${lastLines.join(' | ')}`,
    ].join('\n');
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

  private extractInterest(text: string): string | null {
    const patterns = [
      /(?:me interesa|quiero|busco|necesito)\s+([^.,!?\n]{3,120})/i,
      /(?:estoy interesado en|estoy interesada en)\s+([^.,!?\n]{3,120})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = match?.[1]?.trim();
      if (value) {
        return value.replace(/[.,;!?]+$/, '');
      }
    }

    return null;
  }

  private extractIntent(text: string): string | null {
    const normalized = text.toLowerCase();
    const hotLeadKeywords = ['lo quiero', 'dame uno', 'como compro', 'cómo compro', 'me interesa', 'lo compro'];
    if (hotLeadKeywords.some((keyword) => normalized.includes(keyword))) {
      return 'HOT';
    }

    const intents: Array<{ keywords: string[]; intent: string }> = [
      { keywords: ['precio', 'cuesta', 'vale', 'coste'], intent: 'consulta_precio' },
      { keywords: ['catalogo', 'catálogo'], intent: 'consulta_catalogo' },
      { keywords: ['funciona', 'calidad', 'sirve', 'resultado', 'resultados', 'garantia', 'garantía'], intent: 'duda' },
      { keywords: ['comprar', 'pedido', 'ordenar'], intent: 'compra' },
      { keywords: ['ok', 'perfecto', 'dale', 'esta bien', 'está bien'], intent: 'cierre' },
      { keywords: ['envio', 'delivery', 'entrega'], intent: 'consulta_envio' },
      { keywords: ['info', 'informacion', 'detalles', 'explicame'], intent: 'consulta_informacion' },
      { keywords: ['hola', 'buenas', 'saludos'], intent: 'saludo' },
      { keywords: ['ayuda', 'soporte', 'problema'], intent: 'soporte' },
    ];

    const detected = intents.find(({ keywords }) =>
      keywords.some((keyword) => normalized.includes(keyword)),
    );

    return detected?.intent ?? null;
  }

  private extractNote(text: string): string | null {
    const normalized = text.toLowerCase();
    const objectionKeywords = ['funciona', 'calidad', 'sirve', 'resultado', 'resultados', 'garantia', 'garantía'];
    if (objectionKeywords.some((keyword) => normalized.includes(keyword))) {
      return `Objecion: ${text.replace(/[.,;!?]+$/, '').trim()}`;
    }

    const patterns = [
      /(?:prefiero|prefiero que sea|me gustaria)\s+([^.,!?\n]{3,140})/i,
      /(?:recuerda que|ten en cuenta que)\s+([^.,!?\n]{3,140})/i,
      /(?:soy alergico a|soy alérgico a|no quiero)\s+([^.,!?\n]{3,140})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = match?.[1]?.trim();
      if (value) {
        return value.replace(/[.,;!?]+$/, '');
      }
    }

    return null;
  }

  private mergeNotes(current: string | null, next: string | null): string | null {
    const parts = [current?.trim(), next?.trim()].filter(
      (value): value is string => Boolean(value && value.length > 0),
    );

    if (parts.length === 0) {
      return null;
    }

    return Array.from(new Set(parts)).join(' | ');
  }

  private resolveIntent(currentIntent: string | null, text: string): string | null {
    const nextIntent = this.extractIntent(text);

    if (currentIntent === 'HOT' && nextIntent && nextIntent !== 'HOT') {
      return currentIntent;
    }

    return nextIntent ?? currentIntent ?? null;
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
      interest: memory?.interest ?? null,
      lastIntent: memory?.lastIntent ?? null,
      notes: memory?.notes ?? null,
      updatedAt: memory?.updatedAt ?? null,
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
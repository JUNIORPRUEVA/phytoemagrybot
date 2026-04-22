import { BadRequestException, Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { BotConfigService } from '../bot-config/bot-config.service';
import { ClientConfigService } from '../config/config.service';
import { MediaService } from '../media/media.service';
import { MemoryService } from '../memory/memory.service';
import { BotReplyResult } from './bot.types';

@Injectable()
export class BotService {
  constructor(
    private readonly aiService: AiService,
    private readonly botConfigService: BotConfigService,
    private readonly clientConfigService: ClientConfigService,
    private readonly mediaService: MediaService,
    private readonly memoryService: MemoryService,
  ) {}

  async processIncomingMessage(contactId: string, message: string): Promise<BotReplyResult> {
    const normalizedContactId = contactId.trim();
    const normalizedMessage = message.trim();

    if (!normalizedContactId) {
      throw new BadRequestException('contactId is required');
    }

    if (!/^\+?[0-9A-Za-z._:-]{3,120}$/.test(normalizedContactId)) {
      throw new BadRequestException('contactId is invalid');
    }

    if (!normalizedMessage) {
      throw new BadRequestException('message is required');
    }

    const mediaFiles = await this.getMediaByKeyword(normalizedMessage);

    const config = await this.clientConfigService.getConfig();
    const botConfig = await this.botConfigService.getConfig();
    const memoryWindow = config.aiSettings?.memoryWindow ?? 6;

    await this.memoryService.saveMessage({
      contactId: normalizedContactId,
      role: 'user',
      content: normalizedMessage,
    });

    const memoryContext = await this.memoryService.getConversationContext(
      normalizedContactId,
      memoryWindow,
    );
    const history = this.excludeCurrentUserMessage(
      memoryContext.messages,
      normalizedMessage,
    );

    const reply = await this.aiService.generateReply({
      config,
      fullPrompt: this.botConfigService.getFullPrompt(botConfig),
      contactId: normalizedContactId,
      message: normalizedMessage,
      history,
      context: this.buildConversationContext(memoryContext),
    });

    await this.memoryService.saveMessage({
      contactId: normalizedContactId,
      role: 'assistant',
      content: reply.content,
    });

    return { reply: reply.content, replyType: reply.type, mediaFiles };
  }

  async getMediaByKeyword(text: string) {
    return this.mediaService.getMediaByKeyword(text);
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
      memoryContext.clientMemory.interest
        ? `Interes detectado: ${memoryContext.clientMemory.interest}`
        : null,
      memoryContext.clientMemory.lastIntent
        ? `Ultima intencion detectada: ${memoryContext.clientMemory.lastIntent}`
        : null,
      memoryContext.clientMemory.notes
        ? `Notas importantes: ${memoryContext.clientMemory.notes}`
        : null,
    ].filter((value): value is string => Boolean(value));

    if (memoryLines.length > 0) {
      sections.push(`Memoria persistente:\n${memoryLines.join('\n')}`);
    }

    sections.push(
      'Usa esta memoria para continuar la conversacion de forma natural, recordar datos del cliente y evitar repetir preguntas ya resueltas.',
    );

    return sections.join('\n\n');
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
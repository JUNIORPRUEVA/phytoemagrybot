import { BadRequestException, Injectable } from '@nestjs/common';
import { AssistantReply } from '../ai/ai.types';
import { AiService } from '../ai/ai.service';
import { ClientConfigService } from '../config/config.service';
import { MemoryService } from '../memory/memory.service';

@Injectable()
export class BotService {
  constructor(
    private readonly aiService: AiService,
    private readonly clientConfigService: ClientConfigService,
    private readonly memoryService: MemoryService,
  ) {}

  async processIncomingMessage(
    contactId: string,
    message: string,
  ): Promise<{ reply: string; replyType: AssistantReply['type'] }> {
    if (!contactId || !contactId.trim()) {
      throw new BadRequestException('contactId is required');
    }

    if (!message || !message.trim()) {
      throw new BadRequestException('message is required');
    }

    const config = await this.clientConfigService.getConfig();
    const normalizedContactId = contactId.trim();
    const normalizedMessage = message.trim();

    await this.memoryService.addMessage({
      contactId: normalizedContactId,
      role: 'user',
      content: normalizedMessage,
    });

    const [history, summaryRecord] = await Promise.all([
      this.memoryService.getRecentMessages(normalizedContactId),
      this.memoryService.getSummary(normalizedContactId),
    ]);

    const reply = await this.aiService.generateReply({
      config,
      contactId: normalizedContactId,
      message: normalizedMessage,
      history,
      summary: summaryRecord?.summary,
    });

    await this.memoryService.addMessage({
      contactId: normalizedContactId,
      role: 'assistant',
      content: reply.content,
    });

    const updatedHistory = [...history, { role: 'assistant' as const, content: reply.content }];

    const nextSummary = await this.aiService.summarizeConversation({
      config,
      contactId: normalizedContactId,
      message: normalizedMessage,
      history: updatedHistory,
      summary: summaryRecord?.summary,
    });

    if (nextSummary) {
      await this.memoryService.upsertSummary(normalizedContactId, nextSummary);
    }

    return { reply: reply.content, replyType: reply.type };
  }
}
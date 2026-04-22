import { BadRequestException, Injectable } from '@nestjs/common';
import { AssistantReply } from '../ai/ai.types';
import { AiService } from '../ai/ai.service';
import { ClientConfigService } from '../config/config.service';
import { MemoryService } from '../memory/memory.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class BotService {
  constructor(
    private readonly aiService: AiService,
    private readonly clientConfigService: ClientConfigService,
    private readonly memoryService: MemoryService,
    private readonly redisService: RedisService,
  ) {}

  async processIncomingMessage(
    contactId: string,
    message: string,
  ): Promise<{ reply: string; replyType: AssistantReply['type'] }> {
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

    const cacheKey = `cache:${normalizedContactId}:${normalizedMessage}`;
    const cachedReply = await this.redisService.get<{
      reply: string;
      replyType: AssistantReply['type'];
    }>(cacheKey);

    if (cachedReply) {
      await this.memoryService.addMessage({
        contactId: normalizedContactId,
        role: 'user',
        content: normalizedMessage,
      });

      await this.memoryService.addMessage({
        contactId: normalizedContactId,
        role: 'assistant',
        content: cachedReply.reply,
      });

      return cachedReply;
    }

    const config = await this.clientConfigService.getConfig();
    const responseCacheTtlSeconds = config.botSettings?.responseCacheTtlSeconds ?? 60;
    const memoryWindow = config.aiSettings?.memoryWindow ?? 6;

    await this.memoryService.addMessage({
      contactId: normalizedContactId,
      role: 'user',
      content: normalizedMessage,
    });

    const history = await this.memoryService.getRecentMessages(
      normalizedContactId,
      memoryWindow,
    );

    const reply = await this.aiService.generateReply({
      config,
      contactId: normalizedContactId,
      message: normalizedMessage,
      history,
    });

    await this.memoryService.addMessage({
      contactId: normalizedContactId,
      role: 'assistant',
      content: reply.content,
    });

    await this.redisService.set(
      cacheKey,
      { reply: reply.content, replyType: reply.type },
      responseCacheTtlSeconds,
    );

    return { reply: reply.content, replyType: reply.type };
  }
}
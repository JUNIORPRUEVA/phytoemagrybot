import { Injectable } from '@nestjs/common';
import { ConversationMemory, ConversationSummary } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationRole, StoredMessage } from './memory.types';

@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService) {}

  addMessage(params: {
    contactId: string;
    role: ConversationRole;
    content: string;
  }): Promise<ConversationMemory> {
    return this.prisma.conversationMemory.create({
      data: {
        clientId: 'global',
        contactId: params.contactId,
        role: params.role,
        content: params.content,
      },
    });
  }

  async getRecentMessages(contactId: string, limit = 10): Promise<StoredMessage[]> {
    const messages = await this.prisma.conversationMemory.findMany({
      where: { contactId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        role: true,
        content: true,
      },
    });

    return messages.reverse().map((message) => ({
      role: message.role as ConversationRole,
      content: message.content,
    }));
  }

  getSummary(contactId: string): Promise<ConversationSummary | null> {
    return this.prisma.conversationSummary.findUnique({
      where: {
        clientId_contactId: { clientId: 'global', contactId },
      },
    });
  }

  async upsertSummary(contactId: string, summary: string): Promise<ConversationSummary> {
    return this.prisma.conversationSummary.upsert({
      where: {
        clientId_contactId: { clientId: 'global', contactId },
      },
      create: {
        clientId: 'global',
        contactId,
        summary,
      },
      update: {
        summary,
      },
    });
  }
}
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConversationMemory } from '@prisma/client';
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
    const contactId = params.contactId.trim();
    const content = params.content.trim();

    if (!contactId) {
      throw new BadRequestException('contactId is required');
    }

    if (!content) {
      throw new BadRequestException('content is required');
    }

    return this.prisma.conversationMemory.create({
      data: {
        contactId,
        role: params.role,
        content,
      },
    });
  }

  async getRecentMessages(contactId: string, limit = 10): Promise<StoredMessage[]> {
    const normalizedContactId = contactId.trim();

    if (!normalizedContactId) {
      throw new BadRequestException('contactId is required');
    }

    const messages = await this.prisma.conversationMemory.findMany({
      where: { contactId: normalizedContactId },
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
}
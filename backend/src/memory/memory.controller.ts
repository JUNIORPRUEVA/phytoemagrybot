import { Controller, Get, Param } from '@nestjs/common';
import { MemoryService } from './memory.service';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get(':contactId')
  async getConversationSnapshot(@Param('contactId') contactId: string) {
    return {
      messages: await this.memoryService.getRecentMessages(contactId),
    };
  }
}
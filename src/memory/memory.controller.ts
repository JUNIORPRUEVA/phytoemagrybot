import { Controller, Get, Param } from '@nestjs/common';
import { MemoryService } from './memory.service';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get(':contactId')
  async getConversationSnapshot(@Param('contactId') contactId: string) {
    const [summary, messages] = await Promise.all([
      this.memoryService.getSummary(contactId),
      this.memoryService.getRecentMessages(contactId),
    ]);

    return {
      summary,
      messages,
    };
  }
}
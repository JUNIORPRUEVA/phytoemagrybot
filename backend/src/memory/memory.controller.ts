import { Controller, Get, Param } from '@nestjs/common';
import { MemoryService } from './memory.service';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get('summary/:contactId')
  async getSummary(@Param('contactId') contactId: string) {
    return this.memoryService.getSummary(contactId);
  }

  @Get(':contactId')
  async getConversationSnapshot(@Param('contactId') contactId: string) {
    return this.memoryService.getConversationContext(contactId);
  }
}
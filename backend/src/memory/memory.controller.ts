import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { UpdateMemoryEntryDto } from './dto/update-memory-entry.dto';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get('contacts')
  async listContacts(@Query('query') query?: string) {
    return this.memoryService.listContacts(query);
  }

  @Get('summary/:contactId')
  async getSummary(@Param('contactId') contactId: string) {
    return this.memoryService.getSummary(contactId);
  }

  @Get(':contactId')
  async getConversationSnapshot(@Param('contactId') contactId: string) {
    return this.memoryService.getConversationContext(contactId);
  }

  @Post(':contactId')
  async updateMemoryEntry(
    @Param('contactId') contactId: string,
    @Body() dto: UpdateMemoryEntryDto,
  ) {
    return this.memoryService.updateMemoryEntry(contactId, dto);
  }
}
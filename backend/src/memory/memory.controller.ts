import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryDeleteContactDto } from './dto/memory-delete-contact.dto';
import { MemoryResetAllDto } from './dto/memory-reset-all.dto';
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

  @Post('delete-client')
  async deleteClientMemory(@Body() dto: MemoryDeleteContactDto) {
    return this.memoryService.deleteClientMemory(dto.contactId, dto.actor);
  }

  @Post('delete-conversation')
  async deleteConversation(@Body() dto: MemoryDeleteContactDto) {
    return this.memoryService.deleteConversation(dto.contactId, dto.actor);
  }

  @Post('reset-all')
  async resetAllMemory(@Body() dto: MemoryResetAllDto) {
    return this.memoryService.resetAllMemory(dto.actor);
  }

  @Post(':contactId')
  async updateMemoryEntry(
    @Param('contactId') contactId: string,
    @Body() dto: UpdateMemoryEntryDto,
  ) {
    return this.memoryService.updateMemoryEntry(contactId, dto);
  }
}
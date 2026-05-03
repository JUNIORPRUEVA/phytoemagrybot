import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryDeleteContactDto } from './dto/memory-delete-contact.dto';
import { MemoryResetAllDto } from './dto/memory-reset-all.dto';
import { UpdateMemoryEntryDto } from './dto/update-memory-entry.dto';
import { AuthenticatedRequest } from '../auth/auth.types';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get('contacts')
  async listContacts(@Req() req: AuthenticatedRequest, @Query('query') query?: string) {
    return this.memoryService.listContacts(req.user!.activeCompanyId, query);
  }

  @Get('summary/:contactId')
  async getSummary(@Req() req: AuthenticatedRequest, @Param('contactId') contactId: string) {
    return this.memoryService.getSummary(req.user!.activeCompanyId, contactId);
  }

  @Get(':contactId')
  async getConversationSnapshot(@Req() req: AuthenticatedRequest, @Param('contactId') contactId: string) {
    return this.memoryService.getConversationContext(req.user!.activeCompanyId, contactId);
  }

  @Post('delete-client')
  async deleteClientMemory(@Req() req: AuthenticatedRequest, @Body() dto: MemoryDeleteContactDto) {
    return this.memoryService.deleteClientMemory(req.user!.activeCompanyId, dto.contactId, dto.actor);
  }

  @Post('delete-conversation')
  async deleteConversation(@Req() req: AuthenticatedRequest, @Body() dto: MemoryDeleteContactDto) {
    return this.memoryService.deleteConversation(req.user!.activeCompanyId, dto.contactId, dto.actor);
  }

  @Post('reset-all')
  async resetAllMemory(@Req() req: AuthenticatedRequest, @Body() dto: MemoryResetAllDto) {
    return this.memoryService.resetAllMemory(req.user!.activeCompanyId, dto.actor);
  }

  @Post('delete-all-conversations')
  async deleteAllConversations(@Req() req: AuthenticatedRequest, @Body() dto: MemoryResetAllDto) {
    return this.memoryService.deleteAllConversations(req.user!.activeCompanyId, dto.actor);
  }

  @Post(':contactId')
  async updateMemoryEntry(
    @Req() req: AuthenticatedRequest,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateMemoryEntryDto,
  ) {
    return this.memoryService.updateMemoryEntry(req.user!.activeCompanyId, contactId, dto);
  }
}

import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { BotService } from '../bot/bot.service';
import { FollowupService } from '../followup/followup.service';
import { MemoryService } from '../memory/memory.service';
import { PostMessageDto } from './dto/post-message.dto';
import { ScheduleFollowupDto } from './dto/schedule-followup.dto';
import { UpdateConversationMemoryDto } from './dto/update-conversation-memory.dto';
import { AuthenticatedRequest } from '../auth/auth.types';

@Controller()
export class ConversationsController {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly botService: BotService,
    private readonly followupService: FollowupService,
  ) {}

  @Get('contacts')
  listContacts(@Req() req: AuthenticatedRequest, @Query('query') query?: string) {
    return this.memoryService.listContacts(req.user!.activeCompanyId, query);
  }

  @Get('contacts/:contactId')
  async getContact(@Req() req: AuthenticatedRequest, @Param('contactId') contactId: string) {
    const companyId = req.user!.activeCompanyId;
    const [contact, context, followup] = await Promise.all([
      this.memoryService.getContact(companyId, contactId),
      this.memoryService.getConversationContext(companyId, contactId),
      this.followupService.getFollowupState(contactId, companyId),
    ]);

    return {
      contact,
      context,
      followup,
    };
  }

  @Get('messages/:contactId')
  getMessages(@Req() req: AuthenticatedRequest, @Param('contactId') contactId: string, @Query('limit') limit?: string) {
    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
    return this.memoryService.getRecentMessages(req.user!.activeCompanyId, contactId, Math.min(safeLimit, 100));
  }

  @Post('messages')
  postMessage(@Req() req: AuthenticatedRequest, @Body() dto: PostMessageDto) {
    const companyId = req.user!.activeCompanyId;
    if (dto.direction === 'assistant') {
      return this.followupService.sendManualMessage({
        contactId: dto.contactId,
        outboundAddress: dto.outboundAddress,
        message: dto.content,
        scheduleFollowup: dto.scheduleFollowup,
        companyId,
      });
    }

    return this.botService.processIncomingMessage(dto.contactId, dto.content, companyId);
  }

  @Post('followups')
  scheduleFollowup(@Req() req: AuthenticatedRequest, @Body() dto: ScheduleFollowupDto) {
    return this.followupService.scheduleManualFollowup({
      contactId: dto.contactId,
      outboundAddress: dto.outboundAddress,
      reply: dto.reply,
      nextFollowupAt: dto.nextFollowupAt ? new Date(dto.nextFollowupAt) : undefined,
      companyId: req.user!.activeCompanyId,
    });
  }

  @Post('memory/update')
  updateMemory(@Req() req: AuthenticatedRequest, @Body() dto: UpdateConversationMemoryDto) {
    const { contactId, ...payload } = dto;
    return this.memoryService.updateMemoryEntry(req.user!.activeCompanyId, contactId, payload);
  }
}
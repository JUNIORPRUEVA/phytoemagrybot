import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { BotService } from '../bot/bot.service';
import { FollowupService } from '../followup/followup.service';
import { MemoryService } from '../memory/memory.service';
import { PostMessageDto } from './dto/post-message.dto';
import { ScheduleFollowupDto } from './dto/schedule-followup.dto';
import { UpdateConversationMemoryDto } from './dto/update-conversation-memory.dto';

@Controller()
export class ConversationsController {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly botService: BotService,
    private readonly followupService: FollowupService,
  ) {}

  @Get('contacts')
  listContacts(@Query('query') query?: string) {
    return this.memoryService.listContacts(query);
  }

  @Get('contacts/:contactId')
  async getContact(@Param('contactId') contactId: string) {
    const [contact, context, followup] = await Promise.all([
      this.memoryService.getContact(contactId),
      this.memoryService.getConversationContext(contactId),
      this.followupService.getFollowupState(contactId),
    ]);

    return {
      contact,
      context,
      followup,
    };
  }

  @Get('messages/:contactId')
  getMessages(@Param('contactId') contactId: string, @Query('limit') limit?: string) {
    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
    return this.memoryService.getRecentMessages(contactId, Math.min(safeLimit, 100));
  }

  @Post('messages')
  postMessage(@Body() dto: PostMessageDto) {
    if (dto.direction === 'assistant') {
      return this.followupService.sendManualMessage({
        contactId: dto.contactId,
        outboundAddress: dto.outboundAddress,
        message: dto.content,
        scheduleFollowup: dto.scheduleFollowup,
      });
    }

    return this.botService.processIncomingMessage(dto.contactId, dto.content);
  }

  @Post('followups')
  scheduleFollowup(@Body() dto: ScheduleFollowupDto) {
    return this.followupService.scheduleManualFollowup({
      contactId: dto.contactId,
      outboundAddress: dto.outboundAddress,
      reply: dto.reply,
      nextFollowupAt: dto.nextFollowupAt ? new Date(dto.nextFollowupAt) : undefined,
    });
  }

  @Post('memory/update')
  updateMemory(@Body() dto: UpdateConversationMemoryDto) {
    const { contactId, ...payload } = dto;
    return this.memoryService.updateMemoryEntry(contactId, payload);
  }
}
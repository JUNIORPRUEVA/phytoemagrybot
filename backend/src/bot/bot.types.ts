import { MediaFile } from '@prisma/client';
import { AssistantReply } from '../ai/ai.types';

export interface BotReplyResult {
  reply: string;
  replyType: AssistantReply['type'];
  mediaFiles: MediaFile[];
}
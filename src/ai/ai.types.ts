import { Config } from '@prisma/client';
import { StoredMessage } from '../memory/memory.types';

export type AssistantReplyType = 'text' | 'audio';

export interface AssistantReply {
  type: AssistantReplyType;
  content: string;
}

export interface GenerateReplyParams {
  config: Config;
  contactId: string;
  message: string;
  summary?: string | null;
  history: StoredMessage[];
}
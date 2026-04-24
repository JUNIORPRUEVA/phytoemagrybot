import { AppConfigRecord } from '../config/config.types';
import { StoredMessage } from '../memory/memory.types';

export type AssistantReplyType = 'text' | 'audio';
export type AssistantResponseStyle = 'brief' | 'balanced' | 'detailed';

export interface AssistantReply {
  type: AssistantReplyType;
  content: string;
}

export interface GenerateReplyParams {
  config: AppConfigRecord;
  fullPrompt: string;
  contactId: string;
  message: string;
  history: StoredMessage[];
  context: string;
  responseStyle: AssistantResponseStyle;
}
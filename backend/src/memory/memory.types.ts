export type ConversationRole = 'user' | 'assistant';

export interface StoredMessage {
  role: ConversationRole;
  content: string;
}
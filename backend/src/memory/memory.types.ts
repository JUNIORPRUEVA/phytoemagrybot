export type ConversationRole = 'user' | 'assistant';

export interface StoredMessage {
  role: ConversationRole;
  content: string;
  createdAt?: Date;
}

export interface ClientMemorySnapshot {
  contactId: string;
  name: string | null;
  interest: string | null;
  lastIntent: string | null;
  notes: string | null;
  updatedAt: Date | null;
}

export interface ConversationSummarySnapshot {
  contactId: string;
  summary: string | null;
  updatedAt: Date | null;
}

export interface ConversationContextSnapshot {
  messages: StoredMessage[];
  clientMemory: ClientMemorySnapshot;
  summary: ConversationSummarySnapshot;
}
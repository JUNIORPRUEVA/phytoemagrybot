export type ConversationRole = 'user' | 'assistant';

export type ClientObjective = 'rebajar' | 'info' | 'comprar';
export type ClientInterest = 'precio' | 'resultados' | 'dudas';
export type ClientStatus = 'nuevo' | 'interesado' | 'cliente';

export interface StoredMessage {
  role: ConversationRole;
  content: string;
  createdAt?: Date;
}

/**
 * Personal data that must NEVER be overwritten unless the client explicitly says it changed.
 * Fields are additive: new data is merged, existing data is preserved.
 */
export interface ClientPersonalData {
  phone?: string | null;
  address?: string | null;
  location?: string | null;         // GPS / neighborhood / city they share
  preferences?: string[];           // "me gusta X", "prefiero Y", "no me gusta Z"
}

export interface ClientMemorySnapshot {
  contactId: string;
  name: string | null;
  objective: ClientObjective | null;
  interest: string | null;
  objections: string[];
  status: ClientStatus;
  lastIntent: string | null;
  notes: string | null;
  personalData: ClientPersonalData;
  updatedAt: Date | null;
  expiresAt: Date | null;
}

export interface ConversationSummarySnapshot {
  contactId: string;
  summary: string | null;
  updatedAt: Date | null;
  expiresAt: Date | null;
}

export interface MemoryContactListItem {
  contactId: string;
  name: string | null;
  objective: ClientObjective | null;
  interest: string | null;
  status: ClientStatus;
  lastIntent: string | null;
  summary: string | null;
  lastMessageAt: Date | null;
  memoryUpdatedAt: Date | null;
  summaryUpdatedAt: Date | null;
}

export interface UpdateMemoryEntryInput {
  name?: string | null;
  objective?: ClientObjective | null;
  interest?: string | null;
  objections?: string[] | null;
  status?: ClientStatus | null;
  lastIntent?: string | null;
  notes?: string | null;
  summary?: string | null;
}

export interface ConversationContextSnapshot {
  messages: StoredMessage[];
  clientMemory: ClientMemorySnapshot;
  summary: ConversationSummarySnapshot;
}

export interface MemoryDeleteResult {
  ok: boolean;
  action: 'delete-client' | 'delete-conversation' | 'delete-all-conversations' | 'reset-all';
  actor: string;
  contactId: string | null;
  deletedAt: string;
  counts: Record<string, number>;
}
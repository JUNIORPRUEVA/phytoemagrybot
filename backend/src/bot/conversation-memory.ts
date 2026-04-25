export interface ConversationMemoryState {
  contactId: string;
  sentMessages: string[];
  sentMedia: string[];
  lastMessages: string[];
  lastSentHadVideo: boolean;
  lastIntent: string;
  cooldownMediaUntil: number | null;
}

export type ResponseValidationReason =
  | 'duplicate_text'
  | 'duplicate_video'
  | 'duplicate_media'
  | 'too_many_videos'
  | 'cooldown_active'
  | 'redundant_content'
  | 'no_new_content';

export interface ResponseValidationResult {
  valid: boolean;
  reason?: ResponseValidationReason;
}

const MAX_CONVERSATION_MEMORY_ITEMS = 20;
const CONVERSATION_KEY_PREFIX = 'conversation:';

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function dedupePreservingLast(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    deduped.unshift(value);
  }

  return deduped;
}

function mergeRecent(existing: string[], incoming: string[]): string[] {
  return dedupePreservingLast([
    ...normalizeStringList(existing),
    ...normalizeStringList(incoming),
  ]).slice(-MAX_CONVERSATION_MEMORY_ITEMS);
}

export function getConversationMemoryKey(contactId: string): string {
  return `${CONVERSATION_KEY_PREFIX}${contactId.trim()}`;
}

export function createConversationMemory(
  contactId: string,
  seed?: Partial<ConversationMemoryState>,
): ConversationMemoryState {
  return {
    contactId: contactId.trim(),
    sentMessages: mergeRecent([], seed?.sentMessages ?? []),
    sentMedia: mergeRecent([], seed?.sentMedia ?? []),
    lastMessages: mergeRecent([], seed?.lastMessages ?? []),
    lastSentHadVideo: seed?.lastSentHadVideo === true,
    lastIntent: typeof seed?.lastIntent === 'string' ? seed.lastIntent.trim() : '',
    cooldownMediaUntil:
      typeof seed?.cooldownMediaUntil === 'number' && Number.isFinite(seed.cooldownMediaUntil)
        ? seed.cooldownMediaUntil
        : null,
  };
}

export function normalizeConversationMemory(
  contactId: string,
  value: unknown,
  seed?: {
    sentMessages?: string[];
    sentMedia?: string[];
    lastMessages?: string[];
    lastSentHadVideo?: boolean;
    lastIntent?: string;
    cooldownMediaUntil?: number | null;
  },
): ConversationMemoryState {
  const normalizedContactId = contactId.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createConversationMemory(normalizedContactId, seed);
  }

  const raw = value as Partial<ConversationMemoryState>;
  return createConversationMemory(normalizedContactId, {
    sentMessages: mergeRecent(seed?.sentMessages ?? [], raw.sentMessages ?? []),
    sentMedia: mergeRecent(seed?.sentMedia ?? [], raw.sentMedia ?? []),
    lastMessages: mergeRecent(seed?.lastMessages ?? [], raw.lastMessages ?? []),
    lastSentHadVideo:
      raw.lastSentHadVideo === true || seed?.lastSentHadVideo === true,
    lastIntent:
      typeof raw.lastIntent === 'string' && raw.lastIntent.trim().length > 0
        ? raw.lastIntent.trim()
        : seed?.lastIntent ?? '',
    cooldownMediaUntil:
      typeof raw.cooldownMediaUntil === 'number' && Number.isFinite(raw.cooldownMediaUntil)
        ? raw.cooldownMediaUntil
        : seed?.cooldownMediaUntil ?? null,
  });
}

export function recordConversationDelivery(
  memory: ConversationMemoryState,
  payload: {
    messageText?: string | null;
    mediaIds?: string[];
    lastMessages?: string[];
    lastIntent?: string | null;
    lastSentHadVideo?: boolean;
    cooldownMediaUntil?: number | null;
  },
): ConversationMemoryState {
  return {
    contactId: memory.contactId,
    sentMessages: mergeRecent(memory.sentMessages, payload.messageText ? [payload.messageText] : []),
    sentMedia: mergeRecent(memory.sentMedia, payload.mediaIds ?? []),
    lastMessages: mergeRecent(memory.lastMessages, payload.lastMessages ?? []),
    lastSentHadVideo: payload.lastSentHadVideo ?? memory.lastSentHadVideo,
    lastIntent:
      typeof payload.lastIntent === 'string' && payload.lastIntent.trim().length > 0
        ? payload.lastIntent.trim()
        : memory.lastIntent,
    cooldownMediaUntil:
      typeof payload.cooldownMediaUntil === 'number' || payload.cooldownMediaUntil === null
        ? payload.cooldownMediaUntil
        : memory.cooldownMediaUntil,
  };
}

function normalizeComparableText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeComparableText(value: string): string[] {
  return normalizeComparableText(value)
    .split(' ')
    .filter((token) => token.length >= 3);
}

function looksRedundantText(text: string, history: string[]): boolean {
  const normalizedText = normalizeComparableText(text);
  if (!normalizedText) {
    return false;
  }

  const candidateTokens = new Set(tokenizeComparableText(text));
  if (candidateTokens.size === 0) {
    return false;
  }

  return history.some((item) => {
    const normalizedHistory = normalizeComparableText(item);
    if (!normalizedHistory) {
      return false;
    }

    if (normalizedHistory === normalizedText) {
      return true;
    }

    const historyTokens = new Set(tokenizeComparableText(item));
    if (historyTokens.size === 0) {
      return false;
    }

    let sharedTokens = 0;
    for (const token of candidateTokens) {
      if (historyTokens.has(token)) {
        sharedTokens += 1;
      }
    }

    const overlap = sharedTokens / Math.max(candidateTokens.size, historyTokens.size);
    return overlap >= 0.8;
  });
}

export function buildConversationMemoryContext(memory: ConversationMemoryState): string {
  const sections: string[] = [];

  if (memory.lastMessages.length > 0) {
    sections.push(`Ultimos mensajes:\n- ${memory.lastMessages.slice(-6).join('\n- ')}`);
  }

  if (memory.sentMessages.length > 0) {
    sections.push(`Textos ya enviados, no los repitas exactos:\n- ${memory.sentMessages.slice(-8).join('\n- ')}`);
  }

  if (memory.sentMedia.length > 0) {
    sections.push(`Media ya enviada, no la repitas:\n- ${memory.sentMedia.slice(-8).join('\n- ')}`);
  }

  if (sections.length === 0) {
    return '';
  }

  return `[MEMORIA_RECIENTE]\n${sections.join('\n\n')}`;
}

export function validateResponseCandidate(
  response: {
    text?: string | null;
    mediaIds?: string[];
    videoIds?: string[];
  },
  memory: ConversationMemoryState,
): ResponseValidationResult {
  const text = response.text?.trim() ?? '';
  const mediaIds = normalizeStringList(response.mediaIds ?? []);
  const videoIds = normalizeStringList(response.videoIds ?? []);
  const now = Date.now();

  if (!text && mediaIds.length === 0) {
    return { valid: false, reason: 'no_new_content' };
  }

  if (text && memory.sentMessages.includes(text)) {
    return { valid: false, reason: 'duplicate_text' };
  }

  if (text && looksRedundantText(text, [...memory.sentMessages, ...memory.lastMessages])) {
    return { valid: false, reason: 'redundant_content' };
  }

  if (videoIds.length > 1) {
    return { valid: false, reason: 'too_many_videos' };
  }

  if (memory.lastSentHadVideo && videoIds.length > 0) {
    return { valid: false, reason: 'too_many_videos' };
  }

  if (mediaIds.length > 0 && typeof memory.cooldownMediaUntil === 'number' && now < memory.cooldownMediaUntil) {
    return { valid: false, reason: 'cooldown_active' };
  }

  if (videoIds.some((videoId) => memory.sentMedia.includes(videoId))) {
    return { valid: false, reason: 'duplicate_video' };
  }

  if (mediaIds.some((mediaId) => memory.sentMedia.includes(mediaId))) {
    return { valid: false, reason: 'duplicate_media' };
  }

  return { valid: true };
}
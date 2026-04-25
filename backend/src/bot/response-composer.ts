export type ResponseComposerDiscard = {
  index: number;
  reason: string;
};

export type ResponseComposerResult = {
  totalResponses: number;
  selectedIndex: number;
  selectedText: string;
  discarded: ResponseComposerDiscard[];
};

type ComposeOptions = {
  maxIdeas?: number;
  maxQuestions?: number;
};

const DEFAULT_OPTIONS: Required<ComposeOptions> = {
  maxIdeas: 2,
  maxQuestions: 1,
};

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/["“”'‘’]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[^\p{L}\p{N}\s?!.,]/gu, '')
    .trim();
}

function splitIntoSegments(text: string): string[] {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) {
    return [];
  }

  const rawParts = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return rawParts;
}

function collapseRepeatedLeadPhrases(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  // Collapses things like: "Tranquilo... Perfecto..." -> "Tranquilo..."
  const leadRegex = /^((?:\b(?:tranquilo|perfecto|claro|dale|ok|okay|bien|listo)\b\s*[.!…,-]*\s*){2,})/i;
  if (!leadRegex.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(leadRegex);
  const lead = match?.[1] ?? '';
  const firstWordMatch = lead.match(/\b(?:tranquilo|perfecto|claro|dale|ok|okay|bien|listo)\b/i);
  const firstWord = firstWordMatch?.[0] ?? '';

  const rest = trimmed.slice(lead.length).trim();
  const prefix = firstWord ? `${firstWord}.` : '';

  return [prefix, rest].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function extractFirstOptionIfLooksLikeList(text: string): string {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) {
    return text;
  }

  const listLineCount = lines.filter((line) => /^\d+[).:-]\s+/.test(line) || /^[-•]\s+/.test(line)).length;
  if (listLineCount < 2) {
    return text;
  }

  const firstListLine = lines.find((line) => /^\d+[).:-]\s+/.test(line) || /^[-•]\s+/.test(line));
  if (!firstListLine) {
    return text;
  }

  return firstListLine.replace(/^\d+[).:-]\s+/, '').replace(/^[-•]\s+/, '').trim();
}

export function composeFinalMessage(rawText: string, options?: ComposeOptions): string {
  const { maxIdeas, maxQuestions } = { ...DEFAULT_OPTIONS, ...(options ?? {}) };

  let text = (rawText ?? '').trim();
  if (!text) {
    return '';
  }

  // Normalize whitespace while preserving newlines (needed to detect list-like multi-answer payloads).
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  text = collapseRepeatedLeadPhrases(text);
  text = extractFirstOptionIfLooksLikeList(text);

  const segments = splitIntoSegments(text);
  if (segments.length === 0) {
    return '';
  }

  const seen = new Set<string>();
  const selectedSegments: string[] = [];
  let questionsUsed = 0;

  for (const segment of segments) {
    const normalizedSegment = normalizeForCompare(segment);
    if (!normalizedSegment) {
      continue;
    }

    if (seen.has(normalizedSegment)) {
      continue;
    }

    const isQuestion = /\?/.test(segment) || /^¿/.test(segment);
    if (isQuestion) {
      if (questionsUsed >= maxQuestions) {
        continue;
      }
      questionsUsed += 1;
    }

    selectedSegments.push(segment);
    seen.add(normalizedSegment);

    if (selectedSegments.length >= maxIdeas) {
      break;
    }
  }

  const composed = selectedSegments.join(' ').replace(/\s+/g, ' ').trim();
  if (!composed) {
    return '';
  }

  return composed;
}

function countQuestions(text: string): number {
  const matches = text.match(/\?/g);
  return matches?.length ?? 0;
}

function scoreCandidate(text: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const normalized = (text ?? '').trim();
  if (!normalized) {
    return { score: -1_000_000, reasons: ['empty'] };
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  const segments = splitIntoSegments(normalized);
  const questionCount = countQuestions(normalized);

  let score = 100;

  // Prefer shorter, clearer answers
  score -= Math.max(0, normalized.length - 240) * 0.15;
  score -= Math.max(0, words.length - 45) * 1.5;

  // Penalize too many segments/ideas
  if (segments.length > 2) {
    score -= (segments.length - 2) * 12;
    reasons.push('too_many_ideas');
  }

  if (questionCount > 1) {
    score -= (questionCount - 1) * 20;
    reasons.push('too_many_questions');
  }

  // Penalize lists/options (often indicates multiple answers embedded)
  if (/\b(?:opci[oó]n|respuesta)\s*\d+\b/i.test(normalized) || /^\s*\d+[).:-]\s+/m.test(normalized)) {
    score -= 25;
    reasons.push('looks_like_multiple_options');
  }

  // Penalize obvious repeated lead phrases
  if (/^(?:\b(?:tranquilo|perfecto|claro|dale|ok|okay|bien|listo)\b\s*[.!…,-]*\s*){2,}/i.test(normalized)) {
    score -= 18;
    reasons.push('repetitive_lead');
  }

  return { score, reasons };
}

export function selectBestResponse(candidates: string[]): ResponseComposerResult {
  const totalResponses = candidates.length;

  const prepared = candidates.map((text, index) => {
    const composed = composeFinalMessage(text);
    const scoring = scoreCandidate(composed || text);

    return {
      index,
      rawText: text,
      composedText: composed || text.trim(),
      score: scoring.score,
      reasons: scoring.reasons,
    };
  });

  const uniqueMap = new Map<string, number>();
  const discarded: ResponseComposerDiscard[] = [];

  for (const item of prepared) {
    const key = normalizeForCompare(item.composedText);
    if (!key) {
      discarded.push({ index: item.index, reason: 'empty' });
      continue;
    }

    if (uniqueMap.has(key)) {
      discarded.push({ index: item.index, reason: 'redundant_with_other_candidate' });
      item.score -= 30;
    } else {
      uniqueMap.set(key, item.index);
    }
  }

  let best = prepared[0];
  for (const candidate of prepared) {
    if (candidate.score > best.score) {
      best = candidate;
      continue;
    }

    if (candidate.score === best.score && candidate.composedText.length < best.composedText.length) {
      best = candidate;
    }
  }

  for (const candidate of prepared) {
    if (candidate.index === best.index) {
      continue;
    }

    const reason = candidate.reasons[0] ?? 'lower_score';
    discarded.push({ index: candidate.index, reason });
  }

  return {
    totalResponses,
    selectedIndex: best.index,
    selectedText: best.composedText,
    discarded,
  };
}

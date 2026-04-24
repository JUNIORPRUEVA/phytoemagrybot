import { MediaFile } from '@prisma/client';
import { AssistantReply } from '../ai/ai.types';
import { BotDecisionAction, BotDecisionIntent, ContactStage } from './bot-decision.types';

export type BotIntent =
  | 'interes'
  | 'duda'
  | 'compra'
  | 'cierre'
  | 'catalogo'
  | 'hot'
  | 'otro';

export type BotReplySource = 'ai' | 'cache' | 'hot' | 'duda' | 'cierre' | 'galeria';

export interface BotReplyResult {
  reply: string;
  replyType: AssistantReply['type'];
  mediaFiles: MediaFile[];
  intent: BotIntent;
  decisionIntent: BotDecisionIntent;
  stage: ContactStage;
  action: BotDecisionAction;
  purchaseIntentScore: number;
  hotLead: boolean;
  cached: boolean;
  usedGallery: boolean;
  usedMemory: boolean;
  source: BotReplySource;
}

export interface BotTestStepResult {
  scenario: string;
  contactId: string;
  messages: string[];
  passed: boolean;
  checks: {
    shortReply: boolean;
    usedGallery: boolean;
    detectedHotLead: boolean;
    salesClose: boolean;
  };
  result?: BotReplyResult;
  error?: string;
}

export interface BotTestReport {
  ok: boolean;
  durationMs: number;
  results: BotTestStepResult[];
}
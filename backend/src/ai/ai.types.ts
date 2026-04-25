import { AppConfigRecord } from '../config/config.types';
import { StoredMessage } from '../memory/memory.types';
import { BotDecisionAction, BotDecisionIntent } from '../bot/bot-decision.types';

export type AssistantReplyType = 'text' | 'audio';
export type AssistantResponseStyle = 'brief' | 'balanced' | 'detailed';
export type AssistantLeadStage = 'curioso' | 'interesado' | 'dudoso' | 'listo_para_comprar';
export type AssistantReplyObjective =
  | 'avanzar_conversacion'
  | 'generar_confianza'
  | 'resolver_duda'
  | 'cerrar_venta';

export interface AssistantReply {
  type: AssistantReplyType;
  content: string;
}

export interface AssistantResponseCandidate {
  text: string;
  videoId?: string;
  imageId?: string;
  type?: AssistantReplyType;
}

export interface GenerateReplyParams {
  config: AppConfigRecord;
  fullPrompt: string;
  companyContext: string;
  contactId: string;
  message: string;
  history: StoredMessage[];
  context: string;
  classifiedIntent: BotDecisionIntent;
  decisionAction: BotDecisionAction;
  purchaseIntentScore: number;
  responseStyle: AssistantResponseStyle;
  leadStage: AssistantLeadStage;
  replyObjective: AssistantReplyObjective;
  regenerationInstruction?: string;
  candidateCount?: number;
}
import { AppConfigRecord } from '../config/config.types';
import { StoredMessage } from '../memory/memory.types';

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

export interface GenerateReplyParams {
  config: AppConfigRecord;
  fullPrompt: string;
  companyContext: string;
  contactId: string;
  message: string;
  history: StoredMessage[];
  context: string;
  responseStyle: AssistantResponseStyle;
  leadStage: AssistantLeadStage;
  replyObjective: AssistantReplyObjective;
}
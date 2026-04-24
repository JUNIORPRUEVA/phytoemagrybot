export type BotDecisionIntent =
  | 'precio'
  | 'compra'
  | 'duda'
  | 'info'
  | 'curioso'
  | 'interesado'
  | 'no_interesado'
  | 'otro';

export type ContactStage = 'curioso' | 'interesado' | 'dudoso' | 'listo' | 'cliente';

export type BotDecisionAction =
  | 'cerrar'
  | 'responder_precio_con_valor'
  | 'persuadir'
  | 'guiar'
  | 'hacer_seguimiento';

export type BotIntentClassificationSource = 'rules' | 'ai_fallback' | 'heuristic_fallback';

export interface BotDecisionState {
  intent: BotDecisionIntent;
  classificationSource: BotIntentClassificationSource;
  stage: ContactStage;
  action: BotDecisionAction;
  purchaseIntentScore: number;
  currentIntent: string;
  summaryText: string;
  keyFacts: Record<string, unknown>;
  lastMessageId: string;
}
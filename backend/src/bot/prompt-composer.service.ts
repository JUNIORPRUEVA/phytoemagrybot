import { Injectable } from '@nestjs/common';
import { BotConfigService } from '../bot-config/bot-config.service';
import { ClientConfigService } from '../config/config.service';

@Injectable()
export class PromptComposerService {
  constructor(private readonly botConfigService: BotConfigService) {}

  buildInstructionsBlock(
    config: Awaited<ReturnType<ClientConfigService['getConfig']>>,
    botConfig: Awaited<ReturnType<BotConfigService['getConfig']>>,
  ): string {
    const configurations = this.asRecord(config.configurations);
    const instructions = this.asRecord(configurations.instructions);
    const identity = this.asRecord(instructions.identity);
    const rules = this.asStringList(instructions.rules);
    const salesPrompts = this.asRecord(instructions.salesPrompts);

    const prompts = this.asRecord(configurations.prompts);
    const greetingPrompt = this.asString(prompts.greeting);
    const companyInfoPrompt = this.asString(prompts.companyInfo);
    const productInfoPrompt = this.asString(prompts.productInfo);
    const salesGuidelinesPrompt = this.asString(prompts.salesGuidelines);
    const objectionHandlingPrompt = this.asString(prompts.objectionHandling);
    const closingPrompt = this.asString(prompts.closingPrompt);
    const supportPrompt = this.asString(prompts.supportPrompt);

    const identityFields = [
      this.asString(identity.assistantName) ? 'Nombre: ' + this.asString(identity.assistantName) : '',
      this.asString(identity.role) ? 'Rol: ' + this.asString(identity.role) : '',
      this.asString(identity.objective) ? 'Objetivo: ' + this.asString(identity.objective) : '',
      this.asString(identity.tone) ? 'Tono: ' + this.asString(identity.tone) : '',
      this.asString(identity.personality) ? 'Personalidad: ' + this.asString(identity.personality) : '',
      this.asString(identity.responseStyle) ? 'Estilo: ' + this.asString(identity.responseStyle) : '',
      this.asString(identity.signature) ? 'Firma: ' + this.asString(identity.signature) : '',
      this.asString(identity.guardrails) ? 'Guardrails: ' + this.asString(identity.guardrails) : '',
    ].filter(Boolean);

    const salesFields = [
      this.asString(salesPrompts.opening) ? 'Apertura: ' + this.asString(salesPrompts.opening) : '',
      this.asString(salesPrompts.qualification) ? 'Calificacion: ' + this.asString(salesPrompts.qualification) : '',
      this.asString(salesPrompts.offer) ? 'Oferta: ' + this.asString(salesPrompts.offer) : '',
      this.asString(salesPrompts.objectionHandling) ? 'Objeciones: ' + this.asString(salesPrompts.objectionHandling) : '',
      this.asString(salesPrompts.closing) ? 'Cierre: ' + this.asString(salesPrompts.closing) : '',
      this.asString(salesPrompts.followUp) ? 'Seguimiento: ' + this.asString(salesPrompts.followUp) : '',
    ].filter(Boolean);

    const hasCanonicalContent =
      identityFields.length > 0 ||
      rules.length > 0 ||
      salesFields.length > 0 ||
      Boolean(
        greetingPrompt ||
          companyInfoPrompt ||
          productInfoPrompt ||
          salesGuidelinesPrompt ||
          objectionHandlingPrompt ||
          closingPrompt ||
          supportPrompt,
      );

    // Policy: configurations.* is canonical. Legacy prompts are only injected when canonical is empty.
    const lines: string[] = [];

    if (!hasCanonicalContent) {
      const legacyBasePrompt = [config.promptBase, this.botConfigService.getFullPrompt(botConfig)]
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean)
        .join('\n\n');

      if (legacyBasePrompt) {
        lines.push(legacyBasePrompt);
      }

      return lines.join('\n\n');
    }

    if (identityFields.length > 0) {
      lines.push(identityFields.join('\n'));
    }

    if (rules.length > 0) {
      lines.push('Reglas:\n' + rules.map((r) => '- ' + r).join('\n'));
    }

    if (salesFields.length > 0) {
      lines.push('Ventas:\n' + salesFields.join('\n'));
    }

    if (greetingPrompt) lines.push('[SALUDO]\n' + greetingPrompt);
    if (companyInfoPrompt) lines.push('[EMPRESA - INSTRUCCIONES]\n' + companyInfoPrompt);
    if (productInfoPrompt) lines.push('[PRODUCTOS - INSTRUCCIONES]\n' + productInfoPrompt);
    if (salesGuidelinesPrompt) lines.push('[VENTAS Y CONVERSION]\n' + salesGuidelinesPrompt);
    if (objectionHandlingPrompt) lines.push('[MANEJO DE OBJECIONES]\n' + objectionHandlingPrompt);
    if (closingPrompt) lines.push('[CIERRE]\n' + closingPrompt);
    if (supportPrompt) lines.push('[SOPORTE Y POSTVENTA]\n' + supportPrompt);

    return lines.join('\n\n');
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

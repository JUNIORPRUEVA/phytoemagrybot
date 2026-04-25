import { CompanyContextRecord, CompanyWorkingHour } from '../company-context/company-context.types';

export interface CompanyRuleAnalysis {
  intent: string;
  userState: 'frio' | 'curioso' | 'interesado' | 'listo';
  alreadyExplained: boolean;
  repetitionRisk: boolean;
  nextBestAction: 'explicar' | 'resumir' | 'preguntar' | 'cerrar' | 'avanzar';
  responseStrategy: string;
}

export interface CompanyRuleCheck {
  allowResponse: boolean;
  overrideResponse?: string;
  blockSale?: boolean;
  reason?: string;
}

export function applyCompanyRules(
  userMessage: string,
  analysis: CompanyRuleAnalysis,
  companyData: CompanyContextRecord,
  now = new Date(),
): CompanyRuleCheck {
  const normalizedMessage = normalizeText(userMessage);
  const askingLocation = isLocationQuestion(normalizedMessage);
  const askingSchedule = isScheduleQuestion(normalizedMessage);
  const askingContact = isContactQuestion(normalizedMessage);
  const askingPayment = isPaymentQuestion(normalizedMessage);
  const askingDelivery = isDeliveryQuestion(normalizedMessage);
  const askingImages = isImageQuestion(normalizedMessage);
  const closedNow = isOutsideWorkingHours(companyData.workingHoursJson, now);
  const saleIntent = isSaleIntent(normalizedMessage, analysis);

  if (closedNow && saleIntent) {
    return {
      allowResponse: false,
      overrideResponse: 'Ahora mismo estamos fuera de horario 🙏 mañana temprano te atiendo sin problema',
      blockSale: true,
      reason: 'closed_hours_sale_block',
    };
  }

  if (askingDelivery && closedNow && !allowsOutOfHoursDelivery(companyData)) {
    return {
      allowResponse: false,
      overrideResponse: 'Ahora mismo estamos fuera de horario 🙏 los envios inmediatos los coordinamos en horario de atencion.',
      blockSale: true,
      reason: 'outside_hours_delivery_block',
    };
  }

  if (askingLocation) {
    const overrideResponse = buildLocationResponse(companyData);
    if (overrideResponse) {
      return {
        allowResponse: false,
        overrideResponse,
        blockSale: false,
        reason: 'location_real_data_override',
      };
    }
  }

  if (askingSchedule) {
    const overrideResponse = buildScheduleResponse(companyData, now);
    if (overrideResponse) {
      return {
        allowResponse: false,
        overrideResponse,
        blockSale: false,
        reason: 'schedule_real_data_override',
      };
    }
  }

  if (askingContact) {
    const overrideResponse = buildContactResponse(companyData);
    if (overrideResponse) {
      return {
        allowResponse: false,
        overrideResponse,
        blockSale: false,
        reason: 'contact_real_data_override',
      };
    }
  }

  if (askingPayment) {
    const overrideResponse = buildPaymentResponse(companyData);
    if (overrideResponse) {
      return {
        allowResponse: false,
        overrideResponse,
        blockSale: false,
        reason: 'payment_real_data_override',
      };
    }
  }

  if (askingImages) {
    return {
      allowResponse: true,
      blockSale: false,
      reason: 'require_catalog_media',
    };
  }

  return {
    allowResponse: true,
    blockSale: false,
    reason: 'enforce_real_company_data',
  };
}

export function buildCompanyRuleInstruction(
  userMessage: string,
  companyData: CompanyContextRecord,
  companyCheck: CompanyRuleCheck,
): string {
  const normalizedMessage = normalizeText(userMessage);
  const instructions: string[] = ['[COMPANY_RULE_ENGINE]'];

  instructions.push('La empresa tiene prioridad total sobre cualquier respuesta generada.');
  instructions.push('Nunca inventes telefono, direccion, enlace, horario, metodos de pago ni condiciones de entrega.');

  if (companyData.phone.trim()) {
    instructions.push(`Telefono real: ${companyData.phone.trim()}`);
  }

  if (companyData.whatsapp.trim()) {
    instructions.push(`WhatsApp real: ${companyData.whatsapp.trim()}`);
  }

  if (companyData.address.trim()) {
    instructions.push(`Direccion real: ${companyData.address.trim()}`);
  }

  if (companyData.googleMapsLink.trim()) {
    instructions.push(`Mapa real: ${companyData.googleMapsLink.trim()}`);
  }

  if (companyCheck.reason === 'require_catalog_media') {
    instructions.push('El cliente pidio fotos o media. No respondas solo con texto si existe media disponible.');
    instructions.push('Usa solo media real del catalogo o galeria ya cargada en el contexto.');
  }

  if (isLocationQuestion(normalizedMessage)) {
    instructions.push('Si el cliente pregunta ubicacion, usa solo direccion y enlace reales de la empresa.');
  }

  if (isScheduleQuestion(normalizedMessage)) {
    instructions.push('Si el cliente pregunta horario, responde solo con el horario real configurado.');
  }

  if (isDeliveryQuestion(normalizedMessage) && !allowsOutOfHoursDelivery(companyData)) {
    instructions.push('No prometas envios inmediatos fuera de horario si la empresa no los permite.');
  }

  return instructions.join('\n');
}

export function validateCompanyRuleResponse(
  userMessage: string,
  replyText: string,
  companyData: CompanyContextRecord,
  companyCheck: CompanyRuleCheck,
  selectedMediaCount: number,
): { valid: boolean; reason?: string } {
  const normalizedMessage = normalizeText(userMessage);
  const normalizedReply = normalizeText(replyText);

  if (companyCheck.reason === 'require_catalog_media' && selectedMediaCount === 0) {
    return { valid: false, reason: 'company_rule_requires_catalog_media' };
  }

  if (isLocationQuestion(normalizedMessage)) {
    const address = normalizeText(companyData.address);
    const maps = normalizeText(companyData.googleMapsLink);
    if ((address || maps) && ![address, maps].filter(Boolean).some((item) => normalizedReply.includes(item))) {
      return { valid: false, reason: 'company_rule_requires_real_location' };
    }
  }

  if (isScheduleQuestion(normalizedMessage)) {
    const scheduleTokens = companyData.workingHoursJson
      .flatMap((item) => [item.day, item.from ?? '', item.to ?? ''])
      .map((item) => normalizeText(item))
      .filter((item) => item.length > 0);

    if (scheduleTokens.length > 0 && !scheduleTokens.some((item) => normalizedReply.includes(item))) {
      return { valid: false, reason: 'company_rule_requires_real_schedule' };
    }
  }

  return { valid: true };
}

export function buildCompanyRuleMediaUnavailableResponse(
  companyData: CompanyContextRecord,
): string {
  const companyName = companyData.companyName.trim();
  const parts = [
    companyName ? `Ahora mismo en ${companyName} no tengo fotos cargadas para enviarte por aqui.` : 'Ahora mismo no tengo fotos cargadas para enviarte por aqui.',
    companyData.whatsapp.trim() ? `Si quieres, te ayudo por WhatsApp en ${companyData.whatsapp.trim()} mientras actualizamos la galeria.` : '',
    'Si te interesa, te explico el producto o te aviso apenas tenga una referencia real disponible.',
  ].filter((item) => item.length > 0);

  return parts.join(' ');
}

function buildLocationResponse(companyData: CompanyContextRecord): string | null {
  const companyName = companyData.companyName.trim();
  const parts = [
    companyName ? `${companyName}:` : '',
    companyData.address.trim() ? `Estamos en ${companyData.address.trim()}.` : '',
    companyData.googleMapsLink.trim() ? `Ubicacion: ${companyData.googleMapsLink.trim()}` : '',
  ].filter((item) => item.length > 0);

  return parts.length > 0 ? parts.join(' ') : null;
}

function buildScheduleResponse(companyData: CompanyContextRecord, now: Date): string | null {
  const schedule = formatWorkingHours(companyData.workingHoursJson);
  if (!schedule) {
    return null;
  }

  const openNow = !isOutsideWorkingHours(companyData.workingHoursJson, now);
  const prefix = companyData.companyName.trim() ? `${companyData.companyName.trim()}: ` : '';
  return openNow
    ? `${prefix}Nuestro horario es: ${schedule}. Ahora mismo estamos en horario.`
    : `${prefix}Nuestro horario es: ${schedule}. Ahora mismo estamos fuera de horario.`;
}

function buildContactResponse(companyData: CompanyContextRecord): string | null {
  const companyName = companyData.companyName.trim();
  const parts = [
    companyName ? `${companyName}:` : '',
    companyData.phone.trim() ? `Telefono: ${companyData.phone.trim()}.` : '',
    companyData.whatsapp.trim() ? `WhatsApp: ${companyData.whatsapp.trim()}.` : '',
  ].filter((item) => item.length > 0);

  return parts.length > 0 ? parts.join(' ') : null;
}

function buildPaymentResponse(companyData: CompanyContextRecord): string | null {
  if (companyData.bankAccountsJson.length === 0) {
    return null;
  }

  const first = companyData.bankAccountsJson[0];
  const companyName = companyData.companyName.trim();
  const parts = [
    companyName ? `${companyName}:` : '',
    first.bank ? `Banco: ${first.bank}.` : '',
    first.accountType ? `Tipo: ${first.accountType}.` : '',
    first.number ? `Numero: ${first.number}.` : '',
    first.holder ? `Titular: ${first.holder}.` : '',
  ].filter((item) => item.length > 0);

  return parts.length > 0 ? `Puedes pagar con estos datos reales: ${parts.join(' ')}` : null;
}

function formatWorkingHours(value: CompanyWorkingHour[]): string {
  return value
    .map((item) => {
      const day = normalizeText(item.day);
      if (!day) {
        return '';
      }

      if (!item.open) {
        return `${capitalize(day)} cerrado`;
      }

      if (item.from && item.to) {
        return `${capitalize(day)} ${item.from} a ${item.to}`;
      }

      return `${capitalize(day)} abierto`;
    })
    .filter((item) => item.length > 0)
    .join(', ');
}

function isOutsideWorkingHours(value: CompanyWorkingHour[], now: Date): boolean {
  if (value.length === 0) {
    return false;
  }

  const dayIndex = now.getDay();
  const currentDay = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][dayIndex];
  const entry = value.find((item) => normalizeText(item.day) === currentDay);

  if (!entry) {
    return false;
  }

  if (!entry.open) {
    return true;
  }

  if (!entry.from || !entry.to) {
    return false;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const fromMinutes = parseTimeToMinutes(entry.from);
  const toMinutes = parseTimeToMinutes(entry.to);

  if (fromMinutes === null || toMinutes === null) {
    return false;
  }

  return currentMinutes < fromMinutes || currentMinutes > toMinutes;
}

function allowsOutOfHoursDelivery(companyData: CompanyContextRecord): boolean {
  const usageRules = companyData.usageRulesJson ?? {};
  const raw = [
    usageRules.allow_out_of_hours_delivery,
    usageRules.allowDeliveryOutOfHours,
    usageRules.delivery_outside_business_hours,
    usageRules.delivery_after_hours,
  ].find((value) => value !== undefined && value !== null);

  if (typeof raw === 'boolean') {
    return raw;
  }

  if (typeof raw === 'string') {
    const normalized = normalizeText(raw);
    return ['si', 'yes', 'permitido', 'allow', 'allowed', 'true'].includes(normalized);
  }

  return false;
}

function isSaleIntent(normalizedMessage: string, analysis: CompanyRuleAnalysis): boolean {
  return [
    'precio',
    'comprar',
    'pedido',
    'ordenar',
    'lo quiero',
    'como compro',
    'envio',
    'enviarlo',
    'enviarmelo',
    'mandamelo',
    'mandarmelo',
    'delivery',
  ].some((keyword) => normalizedMessage.includes(keyword))
    || analysis.userState === 'listo'
    || analysis.nextBestAction === 'cerrar'
    || analysis.intent === 'compra'
    || analysis.intent === 'precio';
}

function isLocationQuestion(normalizedMessage: string): boolean {
  return ['donde estan', 'ubicacion', 'direccion', 'maps', 'google maps', 'local'].some((keyword) => normalizedMessage.includes(keyword));
}

function isScheduleQuestion(normalizedMessage: string): boolean {
  return ['horario', 'a que hora', 'abren', 'cierran', 'estan abiertos', 'atienden'].some((keyword) => normalizedMessage.includes(keyword));
}

function isContactQuestion(normalizedMessage: string): boolean {
  return ['telefono', 'contacto', 'numero', 'whatsapp'].some((keyword) => normalizedMessage.includes(keyword));
}

function isPaymentQuestion(normalizedMessage: string): boolean {
  return ['pago', 'pagar', 'cuenta', 'transferencia', 'deposito', 'depósito', 'banreservas'].some((keyword) => normalizedMessage.includes(keyword));
}

function isDeliveryQuestion(normalizedMessage: string): boolean {
  return ['envio', 'delivery', 'entrega', 'mandan', 'mandarlo', 'enviarlo', 'enviarmelo', 'mandamelo', 'mandarmelo'].some((keyword) => normalizedMessage.includes(keyword));
}

function isImageQuestion(normalizedMessage: string): boolean {
  return [
    'foto',
    'fotos',
    'imagen',
    'imagenes',
    'catalogo',
    'muestrame',
    'quiero ver',
    'puedo ver',
    'mandame una foto',
    'mandame fotos',
  ].some((keyword) => normalizedMessage.includes(keyword));
}

function parseTimeToMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s:/.?=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
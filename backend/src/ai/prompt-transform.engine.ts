import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';

export type PromptTransformDebug = {
  original_spanish: string;
  original_company: string;
  xml_generated: string;
  translated_english: string;
  translated_xml: string;
  modules_used: string[];
  translated_company: string;
  included_in_xml: boolean;
  company_validation: {
    hasCompanyModule: boolean;
    hasGeneral: boolean;
    hasHours: boolean;
    hasLocation: boolean;
    hasProducts: boolean;
    translatedToEnglish: boolean;
  };
};

export type PromptTransformResult = {
  xmlEn: string;
  debug: PromptTransformDebug;
};

@Injectable()
export class PromptTransformEngine {
  private static readonly PROMPT_TRANSLATION_TTL_MS = 1000 * 60 * 60 * 12;

  private static readonly ALLOWED_XML_TAGS = new Set([
    'prompts',
    'identity',
    'sales',
    'greeting',
    'media',
    'voice',
    'stop',
    'rules',
    'company',
    'general',
    'hours',
    'location',
    'products',
  ]);

  private readonly translatedPromptCache = new Map<
    string,
    {
      translated: string;
      cachedAt: number;
    }
  >();

  async transform(params: {
    openai: OpenAI;
    modelName: string;
    systemPromptEs: string;
    companyContextEs: string;
    contextEs: string;
    regenerationInstructionEs?: string;
    thinkingInstructionEs?: string;
    candidateCount: number;
  }): Promise<PromptTransformResult> {
    const originalCompany = (params.companyContextEs ?? '').trim();

    const externalContextEs = this.joinBlocks([
      params.contextEs?.trim() ? `MEMORY/ANALYSIS CONTEXT:\n${params.contextEs.trim()}` : '',
      params.regenerationInstructionEs?.trim()
        ? `REGENERATION REQUIRED:\n${params.regenerationInstructionEs.trim()}`
        : '',
      params.thinkingInstructionEs?.trim()
        ? `THINKING INSTRUCTION:\n${params.thinkingInstructionEs.trim()}`
        : '',
    ]);

    const originalSpanish = this.joinBlocks([params.systemPromptEs?.trim() ?? '', externalContextEs]);

    const modulesEs = this.buildModulesFromSystemPrompt(originalSpanish, params.candidateCount);

    // Ensure we do not change bot logic: preserve non-company system-context blocks by embedding them into rules.
    modulesEs.rules = this.joinBlocks([modulesEs.rules, externalContextEs]);

    // Company information must be inside its own XML module (no plain-text company context outside XML).
    modulesEs.company = this.buildCompanyModuleXmlEs(originalCompany);
    const xmlEs = this.buildPromptsXml(modulesEs);

    const translated = await this.translateXmlToEnglish({
      openai: params.openai,
      modelName: params.modelName,
      xmlEs,
    });

    this.assertXmlWellFormed(translated);

    this.assertXmlHasRequiredTags(translated);
    this.assertCompanyHasRequiredSubtags(translated);

    if (this.looksLikeSpanishInsideXml(translated)) {
      throw new Error('Translated prompt XML still contains Spanish text.');
    }

    const translatedCompany = this.extractXmlModuleText(translated, 'company');
    const companyTranslatedToEnglish = !this.looksLikeSpanishText(translatedCompany);
    if (!companyTranslatedToEnglish) {
      throw new Error('Company module is not fully translated to English.');
    }

    const companyValidation = this.getCompanyValidationSnapshot(translated, companyTranslatedToEnglish);

    return {
      xmlEn: translated,
      debug: {
        original_spanish: originalSpanish,
        original_company: originalCompany,
        xml_generated: xmlEs,
        translated_english: translated,
        translated_xml: translated,
        modules_used: this.getModulesUsed(modulesEs),
        translated_company: translatedCompany,
        included_in_xml: /<company>[\s\S]*<\/company>/.test(translated),
        company_validation: companyValidation,
      },
    };
  }

  private buildModulesFromSystemPrompt(systemPromptEs: string, candidateCount: number): {
    identity: string;
    sales: string;
    greeting: string;
    media: string;
    voice: string;
    stop: string;
    rules: string;
    company: string;
  } {
    const identityTagged = this.extractBracketSection(systemPromptEs, 'IDENTIDAD');
    const objectiveTagged = this.extractBracketSection(systemPromptEs, 'OBJETIVO');
    const rulesTagged = this.extractBracketSection(systemPromptEs, 'REGLAS');
    const salesTagged = this.extractBracketSection(systemPromptEs, 'VENTAS');
    const mediaRulesTagged = this.extractBracketSection(systemPromptEs, 'MEDIA_RULES');
    const audioRulesTagged = this.extractBracketSection(systemPromptEs, 'AUDIO_RULES');
    const greetingTagged = this.extractSpecialPrompt(systemPromptEs, 'SALUDO');

    const identity = this.pickBlocks([
      identityTagged,
      objectiveTagged,
      this.extractBlock(systemPromptEs, 'Identidad y comportamiento del bot'),
      this.extractBlock(systemPromptEs, 'Prompt base del sistema'),
      this.extractBlock(systemPromptEs, 'Prompt maestro comercial'),
      this.extractFirstParagraphs(systemPromptEs, 2),
    ]);

    const greetingLegacy = this.extractBlock(systemPromptEs, 'Saludo inicial');
    const greetingRules = [
      'REGLAS NUEVAS DE SALUDOS (obligatorio):',
      '- Detecta usuario nuevo: si NO hay historial reciente y NO hay memoria previa util (nombre/interes/resumen), tratalo como nuevo.',
      '- Si es usuario nuevo: saluda SOLO UNA VEZ (en este primer mensaje) con tono humano dominicano.',
      '- Si NO es usuario nuevo: NO repitas saludo largo; ve directo al punto con continuidad.',
      '- No vender de inmediato en el saludo: primero pregunta en que le puedes ayudar.',
      'Ejemplo (referencial): un saludo corto y humano + una sola pregunta para entender la necesidad.',
    ].join('\n');

    const greeting = this.joinBlocks([
      greetingTagged || greetingLegacy,
      greetingRules,
    ]);

    const products = this.extractBlock(systemPromptEs, 'Productos disponibles');
    const productLegacy = this.extractBlock(systemPromptEs, 'Catalogo y detalles de productos');
    const mediaRules = [
      'REGLAS NUEVAS DE MEDIA (obligatorio):',
      '- Enviar imagen o video si ayuda a vender o aclarar la duda.',
      '- Priorizar media de productos relevantes.',
      '- No decir "no hay fotos" o "no hay videos" sin revisar URLs/IDs de media disponibles en el contexto.',
      '- No inventar IDs/URLs. Usar solo los que existan en el contexto.',
    ].join('\n');
    const media = this.joinBlocks([
      productLegacy,
      products,
      mediaRulesTagged,
      mediaRules,
    ]);

    const voiceDefaults = [
      'REGLAS NUEVAS DE VOICE (obligatorio):',
      '- Usar audio si la explicacion seria larga o si el cliente usa audio.',
      '- Usar texto si es corto (precio, disponibilidad, envio, confirmacion).',
      '- La decision de voice se toma DESPUES de STOP/SALUDOS/MICRO-INTENT/EMOCION y antes de MEDIA.',
    ].join('\n');

    const voice = this.joinBlocks([
      audioRulesTagged,
      voiceDefaults,
    ]);

    const stop = [
      'REGLAS NUEVAS DE STOP (obligatorio):',
      '- Detectar cierre o postergacion (en cualquier idioma): el cliente indica que lo dejara para despues, que te avisara, que no quiere continuar o que ya esta resuelto.',
      '- NO hacer preguntas.',
      '- NO insistir.',
      '- Responder con una confirmacion corta, amable y dejar la puerta abierta.',
    ].join('\n');

    const sales = this.pickBlocks([
      salesTagged,
      this.extractBlock(systemPromptEs, 'Prompts de ventas'),
      this.extractBlock(systemPromptEs, 'Guia comercial y tono de ventas'),
      this.extractBlock(systemPromptEs, 'Manejo de objeciones'),
      this.extractBlock(systemPromptEs, 'Cierre y conversion'),
      this.extractBlock(systemPromptEs, 'Soporte y postventa'),
      this.extractBlock(systemPromptEs, 'Etapa detectada del cliente'),
      this.extractBlock(systemPromptEs, 'Objetivo principal de esta respuesta'),
      this.extractBlock(systemPromptEs, 'Intencion clasificada'),
    ]);

    const rules = this.joinBlocks([
      rulesTagged,
      this.extractBlock(systemPromptEs, 'Fuentes obligatorias antes de responder'),
      this.extractBlock(systemPromptEs, 'Piensa primero y responde despues'),
      this.extractBlock(systemPromptEs, 'Actua como un vendedor dominicano real por WhatsApp'),
      this.extractBlock(systemPromptEs, 'No repitas literalmente frases'),
      [
        'PRIORIDAD DE EJECUCION (OBLIGATORIO, ORDEN EXACTO):',
        '1) STOP (si aplica: detiene TODO y responde con confirmacion corta sin preguntas).',
        '2) GREETING/SALUDOS (solo si es primera interaccion: saluda una vez y haz max 1 pregunta).',
        '3) MICRO-INTENT (si el mensaje es corto/ambigüo: responder minimal y encaminar con max 1 pregunta).',
        '4) EMOCION (ajusta tono: frio/dudoso/interesado/listo; no muestres analisis).',
        '5) VOICE (decidir audio o texto segun modulo VOICE).',
        '6) MEDIA (enviar imagen/video solo si aporta, segun modulo MEDIA; no inventar IDs/URLs).',
        '7) SALES/VENTAS (respuesta final: humana, breve, profesional, sin improvisar fuera del XML).',
        '',
        'REGLAS CRITICAS (PROHIBIDO):',
        '- NO repetir informacion ya dada (usa memoria/historial para evitarlo).',
        '- NO generar multiples mensajes dentro de una sola respuesta.',
        '- NO hacer mas de una pregunta por respuesta.',
        '- NO insistir si el cliente ya cerro o postergo (STOP).',
        '- NO inventar reglas, politicas o comportamiento fuera de estos modulos XML.',
        '',
        'CONTROL DE IDIOMA (OBLIGATORIO):',
        '- El sistema interno (este XML) esta en ingles.',
        '- La respuesta final al cliente SIEMPRE debe ser en español (dominicano natural).',
      ].join('\n'),
      [
        'FORMATO DE SALIDA (OBLIGATORIO):',
        '- Devuelve JSON valido con la clave "responses".',
        '- "responses" debe ser un array con EXACTAMENTE 1 objeto.',
        '- Ese objeto debe incluir: "text" y "type". Puede incluir "videoId" o "imageId" si aplica.',
        '- Usa "type" = "text" normalmente. Usa "audio" solo si de verdad corresponde responder por voz.',
        '- Si no vas a usar media, omite videoId e imageId.',
        '- No inventes IDs/URLs de media.',
      ].join('\n'),
      'IDIOMA DE RESPUESTA (OBLIGATORIO): SIEMPRE responde en español (dominicano natural). NUNCA respondas en ingles.',
      this.extractBlock(systemPromptEs, 'Modo de respuesta'),
      this.extractBlock(systemPromptEs, 'Antes de enviar la respuesta verifica internamente'),
    ]);

    return {
      identity,
      sales,
      greeting,
      media,
      voice,
      stop,
      rules,
      company: '',
    };
  }

  private extractBracketSection(text: string, sectionName: string): string {
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalized = (text ?? '').replace(/\r\n/g, '\n');
    const match = normalized.match(
      new RegExp(`(^|\\n)\\[${escaped}\\]\\s*([\\s\\S]*?)(?=\\n\\[[A-Z0-9_]+\\]|$)`),
    );

    return (match?.[2] ?? '').trim();
  }

  private extractSpecialPrompt(systemPromptEs: string, key: string): string {
    const block = this.extractBracketSection(systemPromptEs, 'PROMPTS_ESPECIALES');
    if (!block) {
      return '';
    }

    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalized = block.replace(/\r\n/g, '\n').trim();
    const match = normalized.match(
      new RegExp(`(^|\\n)${escaped}:\\s*([\\s\\S]*?)(?=\\n[A-Z0-9_]+:|$)`),
    );

    return (match?.[2] ?? '').trim();
  }

  private buildPromptsXml(modules: {
    identity: string;
    sales: string;
    greeting: string;
    media: string;
    voice: string;
    stop: string;
    rules: string;
    company: string;
  }): string {
    const formatTextModule = (tag: string, content: string) => {
      const escaped = this.xmlEscape((content ?? '').trim());
      const indented = escaped
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
      return `  <${tag}>\n${indented}\n  </${tag}>`;
    };

    const formatRawModule = (tag: string, rawXml: string) => {
      const raw = (rawXml ?? '').trim();
      const indented = raw
        ? raw
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n')
        : '';
      return `  <${tag}>\n${indented}\n  </${tag}>`;
    };

    return [
      '<prompts>',
      '',
      formatTextModule('identity', modules.identity),
      '',
      formatTextModule('sales', modules.sales),
      '',
      formatTextModule('greeting', modules.greeting),
      '',
      formatTextModule('media', modules.media),
      '',
      formatTextModule('voice', modules.voice),
      '',
      formatTextModule('stop', modules.stop),
      '',
      formatTextModule('rules', modules.rules),
      '',
      // Company requires nested XML tags; keep it as raw XML (do NOT escape <general>, etc.).
      formatRawModule('company', modules.company),
      '',
      '</prompts>',
    ].join('\n').trim();
  }

  private xmlEscape(text: string): string {
    return (text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private async translateXmlToEnglish(params: {
    openai: OpenAI;
    modelName: string;
    xmlEs: string;
  }): Promise<string> {
    const xmlEs = (params.xmlEs ?? '').trim();
    if (!xmlEs) {
      return xmlEs;
    }

    const hash = createHash('sha256').update(xmlEs).digest('hex');
    const cached = this.translatedPromptCache.get(hash);
    if (cached && Date.now() - cached.cachedAt < PromptTransformEngine.PROMPT_TRANSLATION_TTL_MS) {
      return cached.translated;
    }

    const translated = await this.translateAttempt({
      openai: params.openai,
      modelName: params.modelName,
      xmlEs,
      strict: false,
    });

    if (this.looksLikeSpanishInsideXml(translated)) {
      const strictTranslated = await this.translateAttempt({
        openai: params.openai,
        modelName: params.modelName,
        xmlEs,
        strict: true,
      });

      const finalValue = strictTranslated;
      this.translatedPromptCache.set(hash, { translated: finalValue, cachedAt: Date.now() });
      return finalValue;
    }

    this.translatedPromptCache.set(hash, { translated, cachedAt: Date.now() });
    return translated;
  }

  private async translateAttempt(params: {
    openai: OpenAI;
    modelName: string;
    xmlEs: string;
    strict: boolean;
  }): Promise<string> {
    const completion = await params.openai.chat.completions.create({
      model: params.modelName,
      temperature: 0,
      max_completion_tokens: 2400,
      messages: [
        {
          role: 'system',
          content: [
            'You are a prompt transformation engine.',
            'Translate ALL Spanish content into clear, natural English (not robotic literal).',
            'Output ONLY a single XML document with the same tags and ordering.',
            'CRITICAL RULES:',
            '- Preserve XML tags exactly and DO NOT translate tag names.',
            '- Do not add extra tags or commentary.',
            '- Preserve line breaks and bullet formatting.',
            '- Translate examples too (including phrases like "mañana", "luego").',
            ...(params.strict
              ? [
                  '- STRICT: The output must not contain any Spanish words or accented Spanish characters.',
                  '- If a word is Spanish, translate it or rewrite the sentence in English.',
                ]
              : []),
          ].join('\n'),
        },
        {
          role: 'user',
          content: params.xmlEs,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    return this.extractPromptXml(raw) || params.xmlEs;
  }

  private extractPromptXml(text: string): string {
    const normalized = (text ?? '').trim();
    if (!normalized) {
      return normalized;
    }

    if (normalized.startsWith('<prompts>') && normalized.endsWith('</prompts>')) {
      return normalized;
    }

    const start = normalized.indexOf('<prompts>');
    const end = normalized.lastIndexOf('</prompts>');
    if (start >= 0 && end > start) {
      return normalized.slice(start, end + '</prompts>'.length).trim();
    }

    return normalized;
  }

  private looksLikeSpanishInsideXml(xml: string): boolean {
    const text = (xml ?? '').replace(/<[^>]+>/g, ' ').replace(/https?:\/\/\S+/g, ' ');
    return this.looksLikeSpanishText(text);
  }

  private looksLikeSpanishText(text: string): boolean {
    return this.getSpanishLikelihoodScore(text) >= 2;
  }

  private getSpanishLikelihoodScore(text: string): number {
    const original = (text ?? '').replace(/\r\n/g, '\n').trim();
    if (!original) {
      return 0;
    }

    let score = 0;

    // Very high-confidence Spanish punctuation/diacritics.
    if (/[¿¡]/.test(original)) {
      score += 2;
    }
    if (/[áéíóúñüÁÉÍÓÚÑÜ]/.test(original)) {
      score += 2;
    }

    const normalized = original
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      return score;
    }

    const addIfPresent = (token: string, weight: number) => {
      const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(normalized)) {
        score += weight;
      }
    };

    // Unambiguous / high-confidence Spanish tokens (single hit should fail under strict mode).
    const strongTokens = [
      'hola',
      'buenas',
      'buenos',
      'tardes',
      'dias',
      'manana',
      'luego',
      'despues',
      'gracias',
      'por',
      'favor',
      'envio',
      'entrega',
      'direccion',
      'horario',
      'cliente',
      'vendedor',
      'dominicano',
    ];

    for (const token of strongTokens) {
      // Treat "por favor" as a phrase: individual words are less decisive.
      if (token === 'por' || token === 'favor') {
        continue;
      }
      addIfPresent(token, 2);
    }

    addIfPresent('por', 0);
    addIfPresent('favor', 0);
    if (/\bpor\s+favor\b/i.test(normalized)) {
      score += 2;
    }

    // Medium confidence tokens (avoid ambiguous stopwords like "de", "la", "el", "que").
    const mediumTokens = ['producto', 'productos', 'precio', 'oferta', 'pago', 'transferencia'];
    for (const token of mediumTokens) {
      addIfPresent(token, 1);
    }

    return score;
  }

  private assertXmlWellFormed(xml: string): void {
    const normalized = (xml ?? '').trim();
    if (!normalized) {
      throw new Error('Prompt XML is empty.');
    }

    // Tokenize tags (supports optional attributes even though we don't generate them).
    const tagMatches = normalized.matchAll(/<\/?\s*([a-zA-Z][a-zA-Z0-9_-]*)(?:\s+[^>]*)?>/g);
    const stack: string[] = [];

    for (const match of tagMatches) {
      const full = match[0];
      const name = (match[1] ?? '').trim();
      if (!name) {
        continue;
      }

      if (!PromptTransformEngine.ALLOWED_XML_TAGS.has(name)) {
        throw new Error(`Prompt XML contains an unexpected tag <${name}>.`);
      }

      const isClosing = /^<\//.test(full);
      const isSelfClosing = /\/>\s*$/.test(full);

      if (isSelfClosing) {
        continue;
      }

      if (!isClosing) {
        stack.push(name);
        continue;
      }

      const last = stack.pop();
      if (last !== name) {
        throw new Error('Prompt XML is not well-formed (mismatched closing tags).');
      }
    }

    if (stack.length > 0) {
      throw new Error('Prompt XML is not well-formed (unclosed tags).');
    }

    if (!normalized.startsWith('<prompts>') || !normalized.endsWith('</prompts>')) {
      throw new Error('Prompt XML is not wrapped in <prompts>.');
    }
  }

  private assertXmlHasRequiredTags(xml: string): void {
    const requiredTags = ['identity', 'sales', 'greeting', 'media', 'voice', 'stop', 'rules', 'company'];
    const normalized = (xml ?? '').trim();
    if (!normalized.startsWith('<prompts>') || !normalized.endsWith('</prompts>')) {
      throw new Error('Prompt XML is not wrapped in <prompts>.');
    }

    for (const tag of requiredTags) {
      const openCount = (normalized.match(new RegExp(`<${tag}>`, 'g')) ?? []).length;
      const closeCount = (normalized.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      if (openCount !== 1 || closeCount !== 1) {
        throw new Error(`Prompt XML must contain exactly one <${tag}> module.`);
      }
    }
  }

  private assertCompanyHasRequiredSubtags(xml: string): void {
    const normalized = (xml ?? '').trim();
    const companyInner = this.extractXmlModuleText(normalized, 'company');
    if (!companyInner) {
      throw new Error('Prompt XML must include a non-empty <company> module.');
    }

    const required = ['general', 'hours', 'location', 'products'];
    for (const tag of required) {
      const openCount = (companyInner.match(new RegExp(`<${tag}>`, 'g')) ?? []).length;
      const closeCount = (companyInner.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      if (openCount !== 1 || closeCount !== 1) {
        throw new Error(`Company module must contain exactly one <${tag}> block.`);
      }
    }
  }

  private extractBlock(text: string, title: string): string {
    const normalized = (text ?? '').replace(/\r\n/g, '\n');
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const match = normalized.match(
      new RegExp(`(^|\n)${escaped}:\n([\s\S]*?)(?=\n[^\n]+:\n|\n\n\S|$)`, 'i'),
    );

    if (!match) {
      return '';
    }

    return `${title}:\n${(match[2] ?? '').trim()}`.trim();
  }

  private extractXmlModuleText(xml: string, tag: string): string {
    const normalized = (xml ?? '').trim();
    if (!normalized) {
      return '';
    }

    const match = normalized.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'i'));
    if (!match) {
      return '';
    }

    // Unescape the subset we escape during XML generation.
    return (match[1] ?? '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim();
  }

  private buildCompanyModuleXmlEs(companyContextEs: string): string {
    const raw = (companyContextEs ?? '').trim();
    const extracted = this.extractCompanySectionsEs(raw);

    const buildSection = (tag: string, content: string) => {
      const escaped = this.xmlEscape((content ?? '').trim());
      const indented = escaped
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      return `<${tag}>\n${indented}\n</${tag}>`;
    };

    return [
      buildSection('general', extracted.general),
      buildSection('hours', extracted.hours),
      buildSection('location', extracted.location),
      buildSection('products', extracted.products),
    ].join('\n');
  }

  private extractCompanySectionsEs(companyContextEs: string): {
    general: string;
    hours: string;
    location: string;
    products: string;
  } {
    const text = (companyContextEs ?? '').replace(/\r\n/g, '\n').trim();
    if (!text) {
      return {
        general: 'Sin datos de empresa proporcionados.',
        hours: 'Sin horario proporcionado.',
        location: 'Sin direccion proporcionada.',
        products: 'Sin productos proporcionados.',
      };
    }

    const pickSection = (header: string) => {
      const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = text.match(new RegExp(`(^|\n)${escaped}\n([\s\S]*?)(?=\n\[[A-Z_]+\]|$)`, 'i'));
      return (match?.[2] ?? '').trim();
    };

    const instructions = pickSection('[INSTRUCCIONES]');
    const products = pickSection('[PRODUCTOS]');
    const companyBlock = pickSection('[EMPRESA]');

    const jsonMatch = text.match(/\{\s*"company_name"[\s\S]*?\}/i);
    let jsonSummary = '';
    if (jsonMatch?.[0]) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        const lines: string[] = [];
        if (typeof parsed.company_name === 'string') lines.push(`Nombre: ${parsed.company_name}`);
        if (typeof parsed.phone === 'string') lines.push(`Telefono: ${parsed.phone}`);
        if (typeof parsed.address === 'string') lines.push(`Direccion: ${parsed.address}`);
        if (lines.length > 0) jsonSummary = lines.join('\n');
      } catch {
        // ignore invalid json
      }
    }

    const general = this.joinBlocks([
      instructions,
      jsonSummary,
      companyBlock,
      'Datos de empresa: usa solo lo que aparece en este modulo <company> y NO inventes.',
    ]);

    const hours = this.joinBlocks([
      this.extractLikelyHours(text),
      'Si no hay horario claro, responde que necesitas confirmarlo antes de afirmar.',
    ]);

    const location = this.joinBlocks([
      this.extractLikelyLocation(text),
      'Si no hay direccion clara, pide un punto de referencia o confirma la ciudad.',
    ]);

    return {
      general,
      hours: hours.trim() || 'Sin horario proporcionado.',
      location: location.trim() || 'Sin direccion proporcionada.',
      products: products.trim() || 'Sin productos proporcionados.',
    };
  }

  private extractLikelyHours(text: string): string {
    const normalized = (text ?? '').replace(/\r\n/g, '\n');
    const match = normalized.match(/(horario|horarios|abrimos|abierto|abierta)[^\n]*\n?[^\n]*/i);
    return (match?.[0] ?? '').trim();
  }

  private extractLikelyLocation(text: string): string {
    const normalized = (text ?? '').replace(/\r\n/g, '\n');
    const match = normalized.match(/(direccion|dirección|ubicacion|ubicación|estamos en|nos ubicamos en)[^\n]*\n?[^\n]*/i);
    return (match?.[0] ?? '').trim();
  }

  private getModulesUsed(modulesEs: {
    identity: string;
    sales: string;
    greeting: string;
    media: string;
    voice: string;
    stop: string;
    rules: string;
    company: string;
  }): string[] {
    const used: string[] = [];
    const entries: Array<[string, string]> = [
      ['identity', modulesEs.identity],
      ['sales', modulesEs.sales],
      ['greeting', modulesEs.greeting],
      ['media', modulesEs.media],
      ['voice', modulesEs.voice],
      ['stop', modulesEs.stop],
      ['rules', modulesEs.rules],
      ['company', modulesEs.company],
    ];

    for (const [name, value] of entries) {
      if ((value ?? '').trim().length > 0) {
        used.push(name);
      }
    }

    return used;
  }

  private getCompanyValidationSnapshot(xmlEn: string, translatedToEnglish: boolean): PromptTransformDebug['company_validation'] {
    const normalized = (xmlEn ?? '').trim();
    const hasCompanyModule = /<company>[\s\S]*<\/company>/.test(normalized);
    const companyInner = this.extractXmlModuleText(normalized, 'company');
    const hasTag = (tag: string) =>
      (companyInner.match(new RegExp(`<${tag}>`, 'g')) ?? []).length === 1 &&
      (companyInner.match(new RegExp(`</${tag}>`, 'g')) ?? []).length === 1;

    return {
      hasCompanyModule,
      hasGeneral: hasCompanyModule && hasTag('general'),
      hasHours: hasCompanyModule && hasTag('hours'),
      hasLocation: hasCompanyModule && hasTag('location'),
      hasProducts: hasCompanyModule && hasTag('products'),
      translatedToEnglish,
    };
  }

  private extractFirstParagraphs(text: string, count: number): string {
    const parts = (text ?? '')
      .replace(/\r\n/g, '\n')
      .split(/\n\n+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return parts.slice(0, Math.max(0, count)).join('\n\n');
  }

  private joinBlocks(values: Array<string | undefined | null>): string {
    const blocks = values
      .map((value) => (value ?? '').trim())
      .filter((value) => value.length > 0);
    return blocks.join('\n\n');
  }

  private pickBlocks(values: Array<string | undefined | null>): string {
    return this.joinBlocks(values);
  }
}

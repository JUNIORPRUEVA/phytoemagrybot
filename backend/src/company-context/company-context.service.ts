import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SaveCompanyContextDto } from './dto/save-company-context.dto';
import {
  CompanyBankAccount,
  CompanyContextRecord,
  CompanyImageItem,
  DEFAULT_COMPANY_CONTEXT,
} from './company-context.types';

type CompanyContextTopic = 'location' | 'payment' | 'schedule' | 'contact';

@Injectable()
export class CompanyContextService implements OnModuleInit {
  private static readonly CONTEXT_ID = 1;
  private static readonly KNOWLEDGE_CONTEXT_CACHE_KEY = 'bot:knowledge-context:v1';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureContext();
  }

  async getContext(): Promise<CompanyContextRecord> {
    const record = await this.ensureContext();
    const mapped = this.mapRecord(record);
    await this.redisService.del(CompanyContextService.KNOWLEDGE_CONTEXT_CACHE_KEY);
    return mapped;
  }

  async saveContext(data: SaveCompanyContextDto): Promise<CompanyContextRecord> {
    const current = await this.getContext();
    const latitude = this.normalizeCoordinate(data.latitude, current.latitude);
    const longitude = this.normalizeCoordinate(data.longitude, current.longitude);
    const coordinatesWereProvided = data.latitude !== undefined || data.longitude !== undefined;
    const googleMapsLink = this.resolveGoogleMapsLink(
      latitude,
      longitude,
      coordinatesWereProvided,
      data.googleMapsLink,
      current.googleMapsLink,
    );

    const record = await this.prisma.companyContext.upsert({
      where: { id: CompanyContextService.CONTEXT_ID },
      create: {
        id: CompanyContextService.CONTEXT_ID,
        companyName: this.normalizeText(data.companyName, current.companyName),
        description: this.normalizeText(data.description, current.description),
        phone: this.normalizeText(data.phone, current.phone),
        whatsapp: this.normalizeText(data.whatsapp, current.whatsapp),
        address: this.normalizeText(data.address, current.address),
        latitude,
        longitude,
        googleMapsLink,
        workingHoursJson: this.asJsonValue(
          this.normalizeObject(data.workingHoursJson, current.workingHoursJson),
        ),
        bankAccountsJson: this.asJsonValue(
          this.normalizeBankAccounts(data.bankAccountsJson, current.bankAccountsJson),
        ),
        imagesJson: this.asJsonValue(
          this.normalizeImages(data.imagesJson, current.imagesJson),
        ),
        usageRulesJson: this.asJsonValue(
          this.normalizeObject(data.usageRulesJson, current.usageRulesJson),
        ),
      },
      update: {
        companyName: this.normalizeText(data.companyName, current.companyName),
        description: this.normalizeText(data.description, current.description),
        phone: this.normalizeText(data.phone, current.phone),
        whatsapp: this.normalizeText(data.whatsapp, current.whatsapp),
        address: this.normalizeText(data.address, current.address),
        latitude,
        longitude,
        googleMapsLink,
        workingHoursJson: this.asJsonValue(
          this.normalizeObject(data.workingHoursJson, current.workingHoursJson),
        ),
        bankAccountsJson: this.asJsonValue(
          this.normalizeBankAccounts(data.bankAccountsJson, current.bankAccountsJson),
        ),
        imagesJson: this.asJsonValue(
          this.normalizeImages(data.imagesJson, current.imagesJson),
        ),
        usageRulesJson: this.asJsonValue(
          this.normalizeObject(data.usageRulesJson, current.usageRulesJson),
        ),
      },
    });

    return this.mapRecord(record);
  }

  async buildAgentContext(): Promise<string> {
    const context = await this.getContext();
    const topics = this.getTopicsWithAvailableData(context);

    return this.buildContextMessage(context, topics);
  }

  async buildAgentContextForMessage(message: string): Promise<string> {
    const context = await this.getContext();
    const requestedTopics = this.detectRequestedTopics(message);

    if (requestedTopics.length === 0) {
      return '';
    }

    const allowedTopics = requestedTopics.filter((topic) =>
      this.isTopicAllowed(topic, context.usageRulesJson),
    );

    if (allowedTopics.length === 0) {
      return '';
    }

    return this.buildContextMessage(context, allowedTopics);
  }

  private buildContextMessage(
    context: CompanyContextRecord,
    topics: CompanyContextTopic[],
  ): string {
    const payload = {
      company_name: context.companyName,
      ...(topics.includes('contact')
        ? {
            phone: context.phone,
            whatsapp: context.whatsapp,
          }
        : {}),
      ...(topics.includes('location')
        ? {
            address: context.address,
            latitude: context.latitude,
            longitude: context.longitude,
            google_maps_link: context.googleMapsLink,
          }
        : {}),
      ...(topics.includes('schedule')
        ? {
            working_hours_json: context.workingHoursJson,
          }
        : {}),
      ...(topics.includes('payment')
        ? {
            bank_accounts_json: context.bankAccountsJson,
          }
        : {}),
      usage_rules_json: this.pickUsageRules(context.usageRulesJson, topics),
    };

    if (!this.hasUsefulScopedPayload(payload)) {
      return '';
    }

    return [
      'CONTEXTO_EMPRESA',
      'Este bloque es contexto dinamico complementario. No reemplaza el prompt principal del bot.',
      'Antes de usar cualquier dato, lee usage_rules_json, detecta la intencion del cliente y decide si corresponde usar la informacion.',
      'No uses informacion de la empresa si no hace falta. No repitas datos innecesarios.',
      this.buildScopedUsageHint(topics),
      JSON.stringify(payload, null, 2),
    ].join('\n\n');
  }

  private buildScopedUsageHint(topics: CompanyContextTopic[]): string {
    const hints: string[] = [];

    if (topics.includes('location')) {
      hints.push('Si el cliente pide ubicacion, prioriza google_maps_link y la direccion.');
    }

    if (topics.includes('schedule')) {
      hints.push('Si el cliente pregunta horario, usa working_hours_json.');
    }

    if (topics.includes('payment')) {
      hints.push('Si el cliente quiere pagar o pregunta como pagar, usa bank_accounts_json.');
    }

    if (topics.includes('contact')) {
      hints.push('Si el cliente pide contacto directo, usa phone y whatsapp.');
    }

    return hints.join(' ');
  }

  private hasUsefulScopedPayload(payload: Record<string, unknown>): boolean {
    return Object.entries(payload).some(([key, value]) => {
      if (key === 'company_name' || key === 'usage_rules_json') {
        return false;
      }

      if (typeof value === 'string') {
        return value.trim().length > 0;
      }

      if (Array.isArray(value)) {
        return value.length > 0;
      }

      if (value && typeof value === 'object') {
        return Object.keys(value).length > 0;
      }

      return value !== null && value !== undefined;
    });
  }

  private detectRequestedTopics(message: string): CompanyContextTopic[] {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const topics = new Set<CompanyContextTopic>();

    if (
      [
        'donde estan',
        'dónde están',
        'ubicacion',
        'ubicación',
        'ubicados',
        'direccion',
        'dirección',
        'mapa',
        'local',
        'sucursal',
      ].some((keyword) => normalized.includes(keyword))
    ) {
      topics.add('location');
    }

    if (
      [
        'como pago',
        'cómo pago',
        'pagar',
        'pago',
        'transferencia',
        'deposito',
        'depósito',
        'cuenta bancaria',
        'cuentas bancarias',
        'banco',
      ].some((keyword) => normalized.includes(keyword))
    ) {
      topics.add('payment');
    }

    if (
      [
        'horario',
        'hora trabajan',
        'horas trabajan',
        'a que hora',
        'a qué hora',
        'abren',
        'cierran',
        'atienden',
      ].some((keyword) => normalized.includes(keyword))
    ) {
      topics.add('schedule');
    }

    if (
      ['telefono', 'teléfono', 'whatsapp', 'contacto', 'llamar', 'numero', 'número'].some(
        (keyword) => normalized.includes(keyword),
      )
    ) {
      topics.add('contact');
    }

    return Array.from(topics);
  }

  private isTopicAllowed(
    topic: CompanyContextTopic,
    usageRules: Record<string, unknown>,
  ): boolean {
    const ruleKey = this.getRuleKey(topic);
    const ruleValue = usageRules[ruleKey];

    if (typeof ruleValue !== 'string') {
      return true;
    }

    const normalizedRule = ruleValue.trim().toLowerCase();
    if (!normalizedRule) {
      return true;
    }

    return ![
      'nunca',
      'never',
      'disabled',
      'desactivado',
      'false',
      'no_enviar',
      'prohibido',
    ].some((keyword) => normalizedRule.includes(keyword));
  }

  private getRuleKey(topic: CompanyContextTopic): string {
    switch (topic) {
      case 'location':
        return 'send_location';
      case 'payment':
        return 'send_bank_accounts';
      case 'schedule':
        return 'send_schedule';
      case 'contact':
        return 'send_contact';
    }
  }

  private pickUsageRules(
    usageRules: Record<string, unknown>,
    topics: CompanyContextTopic[],
  ): Record<string, unknown> {
    const next: Record<string, unknown> = {};

    for (const topic of topics) {
      const key = this.getRuleKey(topic);
      if (usageRules[key] !== undefined) {
        next[key] = usageRules[key];
      }
    }

    return next;
  }

  private getTopicsWithAvailableData(context: CompanyContextRecord): CompanyContextTopic[] {
    const topics: CompanyContextTopic[] = [];

    if (context.phone.trim() || context.whatsapp.trim()) {
      topics.push('contact');
    }
    if (
      context.address.trim() ||
      context.googleMapsLink.trim() ||
      context.latitude !== null ||
      context.longitude !== null
    ) {
      topics.push('location');
    }
    if (Object.keys(context.workingHoursJson).length > 0) {
      topics.push('schedule');
    }
    if (context.bankAccountsJson.length > 0) {
      topics.push('payment');
    }

    return topics;
  }

  private ensureContext() {
    return this.prisma.companyContext.upsert({
      where: { id: CompanyContextService.CONTEXT_ID },
      create: {
        id: CompanyContextService.CONTEXT_ID,
        companyName: DEFAULT_COMPANY_CONTEXT.companyName,
        description: DEFAULT_COMPANY_CONTEXT.description,
        phone: DEFAULT_COMPANY_CONTEXT.phone,
        whatsapp: DEFAULT_COMPANY_CONTEXT.whatsapp,
        address: DEFAULT_COMPANY_CONTEXT.address,
        latitude: DEFAULT_COMPANY_CONTEXT.latitude,
        longitude: DEFAULT_COMPANY_CONTEXT.longitude,
        googleMapsLink: DEFAULT_COMPANY_CONTEXT.googleMapsLink,
        workingHoursJson: this.asJsonValue(DEFAULT_COMPANY_CONTEXT.workingHoursJson),
        bankAccountsJson: this.asJsonValue(DEFAULT_COMPANY_CONTEXT.bankAccountsJson),
        imagesJson: this.asJsonValue(DEFAULT_COMPANY_CONTEXT.imagesJson),
        usageRulesJson: this.asJsonValue(DEFAULT_COMPANY_CONTEXT.usageRulesJson),
      },
      update: {},
    });
  }

  private asJsonValue(value: object | unknown[]): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private mapRecord(record: {
    id: number;
    companyName: string;
    description: string;
    phone: string;
    whatsapp: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
    googleMapsLink: string;
    workingHoursJson: unknown;
    bankAccountsJson: unknown;
    imagesJson: unknown;
    usageRulesJson: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): CompanyContextRecord {
    return {
      id: record.id,
      companyName: record.companyName,
      description: record.description,
      phone: record.phone,
      whatsapp: record.whatsapp,
      address: record.address,
      latitude: record.latitude,
      longitude: record.longitude,
      googleMapsLink: record.googleMapsLink,
      workingHoursJson: this.normalizeObject(record.workingHoursJson, {}),
      bankAccountsJson: this.normalizeBankAccounts(record.bankAccountsJson, []),
      imagesJson: this.normalizeImages(record.imagesJson, []),
      usageRulesJson: this.normalizeObject(record.usageRulesJson, {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private normalizeText(value: string | undefined, fallback: string): string {
    if (value === undefined) {
      return fallback;
    }

    return value.trim();
  }

  private normalizeCoordinate(
    value: number | null | undefined,
    fallback: number | null,
  ): number | null {
    if (value === undefined) {
      return fallback;
    }

    if (value === null || Number.isNaN(value) || !Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  private resolveGoogleMapsLink(
    latitude: number | null,
    longitude: number | null,
    coordinatesWereProvided: boolean,
    explicitValue: string | undefined,
    fallback: string,
  ): string {
    const manualLink = this.normalizeText(explicitValue, '').trim();
    if (manualLink) {
      return manualLink;
    }

    if (latitude === null || longitude === null) {
      return coordinatesWereProvided ? '' : fallback;
    }

    return `https://www.google.com/maps?q=${latitude},${longitude}`;
  }

  private normalizeObject(
    value: unknown,
    fallback: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return fallback;
    }

    return { ...(value as Record<string, unknown>) };
  }

  private normalizeBankAccounts(
    value: unknown,
    fallback: CompanyBankAccount[],
  ): CompanyBankAccount[] {
    if (!Array.isArray(value)) {
      return fallback;
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const record = item as Record<string, unknown>;
        const bank = this.normalizeUnknownText(record.bank);
        const accountType = this.normalizeUnknownText(record.accountType);
        const number = this.normalizeUnknownText(record.number);
        const holder = this.normalizeUnknownText(record.holder);
        const image = this.normalizeUnknownText(record.image);

        if (!bank && !accountType && !number && !holder && !image) {
          return null;
        }

        return {
          bank,
          accountType,
          number,
          holder,
          image,
        };
      })
      .filter((item): item is CompanyBankAccount => item !== null);
  }

  private normalizeImages(
    value: unknown,
    fallback: CompanyImageItem[],
  ): CompanyImageItem[] {
    if (!Array.isArray(value)) {
      return fallback;
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const url = this.normalizeUnknownText((item as Record<string, unknown>).url);
        if (!url) {
          return null;
        }

        return { url };
      })
      .filter((item): item is CompanyImageItem => item !== null);
  }

  private normalizeUnknownText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
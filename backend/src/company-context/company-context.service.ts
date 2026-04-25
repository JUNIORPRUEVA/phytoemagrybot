import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SaveCompanyContextDto } from './dto/save-company-context.dto';
import {
  CompanyBankAccount,
  CompanyContextRecord,
  CompanyImageItem,
  CompanyWorkingHour,
  DEFAULT_COMPANY_CONTEXT,
} from './company-context.types';

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
          this.normalizeWorkingHours(data.workingHoursJson, current.workingHoursJson),
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
          this.normalizeWorkingHours(data.workingHoursJson, current.workingHoursJson),
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
    return this.buildCompanyContext(context);
  }

  async buildAgentContextForMessage(message: string): Promise<string> {
    const context = await this.getContext();
    return this.buildCompanyContext(context);
  }

  buildCompanyContext(context: CompanyContextRecord): string {
    const sections: string[] = [];
    const companyLines: string[] = [];

    if (context.companyName.trim()) {
      companyLines.push(`Nombre: ${context.companyName.trim()}`);
    }
    if (context.phone.trim()) {
      companyLines.push(`Telefono: ${context.phone.trim()}`);
    }
    if (context.address.trim()) {
      companyLines.push(`Direccion: ${context.address.trim()}`);
    }
    if (context.description.trim()) {
      companyLines.push(`Descripcion: ${context.description.trim()}`);
    }
    if (context.googleMapsLink.trim()) {
      companyLines.push(`Google Maps: ${context.googleMapsLink.trim()}`);
    }

    if (companyLines.length > 0) {
      sections.push('EMPRESA:\n' + companyLines.join('\n'));
    }

    const scheduleBlock = this.formatWorkingHours(context.workingHoursJson);
    if (scheduleBlock.length > 0) {
      sections.push(`HORARIO:\n${scheduleBlock}`);
    }

    const accountsBlock = this.formatBankAccounts(context.bankAccountsJson);
    if (accountsBlock.length > 0) {
      sections.push(`CUENTAS:\n${accountsBlock}`);
    }

    if (sections.length === 0) {
      return '';
    }

    sections.push(
      'Esta informacion de empresa es obligatoria dentro del conocimiento del bot. Si el cliente pregunta ubicacion, horario o pago, debes responder usando estos datos reales. Nunca ignores esta informacion cuando sea relevante y nunca inventes datos.',
    );

    return sections.join('\n\n');
  }

  private formatWorkingHours(value: CompanyWorkingHour[]): string {
    const lines = value
      .map((item) => {
        const day = this.normalizeUnknownText(item.day);
        if (!day) {
          return '';
        }

        if (!item.open) {
          return `- ${this.formatDayLabel(day)}: cerrado`;
        }

        const from = this.normalizeUnknownText(item.from);
        const to = this.normalizeUnknownText(item.to);
        if (from && to) {
          return `- ${this.formatDayLabel(day)}: ${from} - ${to}`;
        }

        return `- ${this.formatDayLabel(day)}: abierto`;
      })
      .filter((line) => line.length > 0);

    return lines.join('\n');
  }

  private formatBankAccounts(value: CompanyBankAccount[]): string {
    const blocks = value
      .map((item) => {
        const lines = [
          item.bank ? `Banco: ${item.bank}` : '',
          item.accountType ? `Tipo: ${item.accountType}` : '',
          item.number ? `Numero: ${item.number}` : '',
          item.holder ? `Titular: ${item.holder}` : '',
          item.image ? `Soporte: ${item.image}` : '',
        ].filter((line) => line.length > 0);

        if (lines.length === 0) {
          return '';
        }

        return `- ${lines.join(' | ')}`;
      })
      .filter((item) => item.length > 0);

    return blocks.join('\n');
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
      workingHoursJson: this.normalizeWorkingHours(record.workingHoursJson, []),
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

  private normalizeWorkingHours(
    value: unknown,
    fallback: CompanyWorkingHour[],
  ): CompanyWorkingHour[] {
    if (!Array.isArray(value)) {
      return fallback;
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const record = item as Record<string, unknown>;
        const day = this.normalizeUnknownText(record.day);
        const from = this.normalizeUnknownText(record.from);
        const to = this.normalizeUnknownText(record.to);
        const open = typeof record.open === 'boolean' ? record.open : false;

        if (!day) {
          return null;
        }

        return {
          day,
          open,
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        };
      })
      .filter((item): item is CompanyWorkingHour => item !== null);
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

  private formatDayLabel(day: string): string {
    switch (day.trim().toLowerCase()) {
      case 'lunes':
        return 'Lunes';
      case 'martes':
        return 'Martes';
      case 'miercoles':
      case 'miércoles':
        return 'Miercoles';
      case 'jueves':
        return 'Jueves';
      case 'viernes':
        return 'Viernes';
      case 'sabado':
      case 'sábado':
        return 'Sabado';
      case 'domingo':
        return 'Domingo';
      default:
        return day;
    }
  }
}
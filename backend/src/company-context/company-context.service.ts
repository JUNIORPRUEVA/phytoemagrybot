import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SaveCompanyContextDto } from './dto/save-company-context.dto';
import {
  CompanyBankAccount,
  CompanyContextRecord,
  CompanyImageItem,
  DEFAULT_COMPANY_CONTEXT,
} from './company-context.types';

@Injectable()
export class CompanyContextService implements OnModuleInit {
  private static readonly CONTEXT_ID = 1;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureContext();
  }

  async getContext(): Promise<CompanyContextRecord> {
    const record = await this.ensureContext();
    return this.mapRecord(record);
  }

  async saveContext(data: SaveCompanyContextDto): Promise<CompanyContextRecord> {
    const current = await this.getContext();
    const latitude = this.normalizeCoordinate(data.latitude, current.latitude);
    const longitude = this.normalizeCoordinate(data.longitude, current.longitude);
    const googleMapsLink = this.buildGoogleMapsLink(
      latitude,
      longitude,
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
        workingHoursJson: this.normalizeObject(data.workingHoursJson, current.workingHoursJson),
        bankAccountsJson: this.normalizeBankAccounts(
          data.bankAccountsJson,
          current.bankAccountsJson,
        ),
        imagesJson: this.normalizeImages(data.imagesJson, current.imagesJson),
        usageRulesJson: this.normalizeObject(data.usageRulesJson, current.usageRulesJson),
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
        workingHoursJson: this.normalizeObject(data.workingHoursJson, current.workingHoursJson),
        bankAccountsJson: this.normalizeBankAccounts(
          data.bankAccountsJson,
          current.bankAccountsJson,
        ),
        imagesJson: this.normalizeImages(data.imagesJson, current.imagesJson),
        usageRulesJson: this.normalizeObject(data.usageRulesJson, current.usageRulesJson),
      },
    });

    return this.mapRecord(record);
  }

  async buildAgentContext(): Promise<string> {
    const context = await this.getContext();
    const payload = {
      company_name: context.companyName,
      description: context.description,
      phone: context.phone,
      whatsapp: context.whatsapp,
      address: context.address,
      latitude: context.latitude,
      longitude: context.longitude,
      google_maps_link: context.googleMapsLink,
      working_hours_json: context.workingHoursJson,
      bank_accounts_json: context.bankAccountsJson,
      images_json: context.imagesJson,
      usage_rules_json: context.usageRulesJson,
    };

    const hasContent = Object.values(payload).some((value) => {
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

    if (!hasContent) {
      return '';
    }

    return [
      'CONTEXTO_EMPRESA',
      'Este bloque es contexto dinamico complementario. No reemplaza el prompt principal del bot.',
      'Antes de usar cualquier dato, lee usage_rules_json, detecta la intencion del cliente y decide si corresponde usar la informacion.',
      'No uses informacion de la empresa si no hace falta. No repitas datos innecesarios.',
      'Cuando el cliente pida ubicacion, prioriza google_maps_link. Cuando pregunte horario, usa working_hours_json. Cuando quiera pagar o pregunte como pagar, usa bank_accounts_json.',
      JSON.stringify(payload, null, 2),
    ].join('\n\n');
  }

  private ensureContext() {
    return this.prisma.companyContext.upsert({
      where: { id: CompanyContextService.CONTEXT_ID },
      create: {
        id: CompanyContextService.CONTEXT_ID,
        ...DEFAULT_COMPANY_CONTEXT,
      },
      update: {},
    });
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

  private buildGoogleMapsLink(
    latitude: number | null,
    longitude: number | null,
    fallback: string,
  ): string {
    if (latitude === null || longitude === null) {
      return fallback;
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
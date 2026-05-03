import { Injectable, NotFoundException } from '@nestjs/common';
import { Company, CompanyStatus, CompanyUserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyInput } from './company.types';

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateCompanyInput, ownerId: string): Promise<Company> {
    const slug = this.buildSlug(input.name);
    const uniqueSlug = await this.ensureUniqueSlug(slug);

    const company = await this.prisma.company.create({
      data: {
        name: input.name.trim(),
        slug: uniqueSlug,
        phone: input.phone?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        status: CompanyStatus.trial,
      },
    });

    await this.prisma.companyUser.create({
      data: {
        companyId: company.id,
        userId: ownerId,
        role: CompanyUserRole.owner,
        isActive: true,
      },
    });

    return company;
  }

  async getById(id: string): Promise<Company> {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Empresa no encontrada.');
    return company;
  }

  async listByUser(userId: string): Promise<Company[]> {
    const memberships = await this.prisma.companyUser.findMany({
      where: { userId, isActive: true },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => m.company);
  }

  async getCompanyUserRole(
    companyId: string,
    userId: string,
  ): Promise<CompanyUserRole | null> {
    const membership = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    return membership?.isActive ? membership.role : null;
  }

  async assertUserBelongsToCompany(companyId: string, userId: string): Promise<void> {
    const role = await this.getCompanyUserRole(companyId, userId);
    if (!role) {
      throw new NotFoundException('No perteneces a esta empresa.');
    }
  }

  async findDefaultCompanyForUser(userId: string): Promise<Company | null> {
    const membership = await this.prisma.companyUser.findFirst({
      where: { userId, isActive: true },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    });
    return membership?.company ?? null;
  }

  async seedCompanyResources(companyId: string): Promise<void> {
    // Ensure Config exists for the company
    await this.prisma.config.upsert({
      where: { companyId },
      create: {
        companyId,
        openaiKey: '',
        promptBase:
          'Eres un asistente de ventas por WhatsApp. Hablas como una persona real, respondes corto y siempre guias al cliente hacia la compra.',
        configurations: {},
      },
      update: {},
    });

    // Ensure BotConfig exists
    await this.prisma.botConfig.upsert({
      where: { companyId },
      create: {
        companyId,
        promptBase: 'Eres un asistente de ventas profesional y amable.',
        promptShort: 'Responde de forma corta y directa.',
        promptHuman: 'Habla como una persona real, no como un robot.',
        promptSales: 'Siempre guia al cliente hacia la compra.',
      },
      update: {},
    });

    // Ensure CompanyContext exists
    await this.prisma.companyContext.upsert({
      where: { companyId },
      create: {
        companyId,
        companyName: '',
        description: '',
        phone: '',
        whatsapp: '',
        address: '',
        workingHoursJson: [],
        bankAccountsJson: [],
        imagesJson: [],
        usageRulesJson: {},
      },
      update: {},
    });
  }

  toPublicCompany(company: Company) {
    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
      legalName: company.legalName,
      phone: company.phone,
      email: company.email,
      logoUrl: company.logoUrl,
      address: company.address,
      status: company.status,
      createdAt: company.createdAt,
    };
  }

  private buildSlug(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
  }

  private async ensureUniqueSlug(base: string): Promise<string> {
    let candidate = base;
    let attempt = 0;

    while (true) {
      const existing = await this.prisma.company.findUnique({
        where: { slug: candidate },
      });
      if (!existing) return candidate;
      attempt++;
      candidate = `${base}-${attempt}`;
    }
  }
}

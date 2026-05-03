import { CompanyStatus, CompanyUserRole } from '@prisma/client';

export interface CompanyRecord {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  rnc: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  address: string | null;
  status: CompanyStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyUserRecord {
  id: string;
  companyId: string;
  userId: string;
  role: CompanyUserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCompanyInput {
  name: string;
  phone?: string | null;
  email?: string | null;
}

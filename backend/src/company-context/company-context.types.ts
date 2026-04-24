export interface CompanyBankAccount {
  bank: string;
  accountType: string;
  number: string;
  holder: string;
  image: string;
}

export interface CompanyImageItem {
  url: string;
}

export interface CompanyContextRecord {
  id: number;
  companyName: string;
  description: string;
  phone: string;
  whatsapp: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  googleMapsLink: string;
  workingHoursJson: Record<string, unknown>;
  bankAccountsJson: CompanyBankAccount[];
  imagesJson: CompanyImageItem[];
  usageRulesJson: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_COMPANY_CONTEXT = {
  companyName: '',
  description: '',
  phone: '',
  whatsapp: '',
  address: '',
  latitude: null,
  longitude: null,
  googleMapsLink: '',
  workingHoursJson: {},
  bankAccountsJson: [],
  imagesJson: [],
  usageRulesJson: {},
} as const;
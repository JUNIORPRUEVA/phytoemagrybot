import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class SaveCompanyBankAccountDto {
  @IsString()
  bank!: string;

  @IsString()
  accountType!: string;

  @IsString()
  number!: string;

  @IsString()
  holder!: string;

  @IsString()
  @IsOptional()
  image?: string;
}

class SaveCompanyImageDto {
  @IsString()
  url!: string;
}

export class SaveCompanyContextDto {
  @IsString()
  @IsOptional()
  companyName?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  whatsapp?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  latitude?: number | null;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  longitude?: number | null;

  @IsObject()
  @IsOptional()
  workingHoursJson?: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveCompanyBankAccountDto)
  @IsOptional()
  bankAccountsJson?: SaveCompanyBankAccountDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveCompanyImageDto)
  @IsOptional()
  imagesJson?: SaveCompanyImageDto[];

  @IsObject()
  @IsOptional()
  usageRulesJson?: Record<string, unknown>;
}
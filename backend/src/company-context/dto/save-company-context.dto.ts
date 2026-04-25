import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
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

class SaveCompanyWorkingHourDto {
  @IsString()
  day!: string;

  @IsBoolean()
  open!: boolean;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  @IsOptional()
  from?: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  @IsOptional()
  to?: string;
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

  @IsString()
  @IsOptional()
  googleMapsLink?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  latitude?: number | null;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  longitude?: number | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveCompanyWorkingHourDto)
  @IsOptional()
  workingHoursJson?: SaveCompanyWorkingHourDto[];

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
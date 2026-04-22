import { IsOptional, IsString } from 'class-validator';

export class SaveBotConfigDto {
  @IsString()
  @IsOptional()
  promptBase?: string;

  @IsString()
  @IsOptional()
  promptShort?: string;

  @IsString()
  @IsOptional()
  promptHuman?: string;

  @IsString()
  @IsOptional()
  promptSales?: string;
}
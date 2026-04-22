import { IsObject, IsOptional, IsString } from 'class-validator';

export class SaveConfigDto {
  @IsString()
  @IsOptional()
  openaiKey?: string;

  @IsString()
  @IsOptional()
  elevenlabsKey?: string;

  @IsString()
  @IsOptional()
  promptBase?: string;

  @IsObject()
  @IsOptional()
  configurations?: Record<string, unknown>;
}
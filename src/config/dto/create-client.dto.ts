import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  openaiKey!: string;

  @IsString()
  @IsOptional()
  elevenlabsKey?: string;

  @IsString()
  @IsNotEmpty()
  promptBase!: string;

  @IsObject()
  @IsOptional()
  configurations?: Record<string, unknown>;
}
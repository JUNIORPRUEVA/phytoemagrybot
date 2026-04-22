import { IsOptional, IsString } from 'class-validator';

export class UpdateMemoryEntryDto {
  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsString()
  interest?: string | null;

  @IsOptional()
  @IsString()
  lastIntent?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsString()
  summary?: string | null;
}
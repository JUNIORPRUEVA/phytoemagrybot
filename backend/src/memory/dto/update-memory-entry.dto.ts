import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ClientObjective, ClientStatus } from '../memory.types';

const OBJECTIVES: ClientObjective[] = ['rebajar', 'info', 'comprar'];
const STATUSES: ClientStatus[] = ['nuevo', 'interesado', 'cliente'];

export class UpdateMemoryEntryDto {
  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsIn(OBJECTIVES)
  objective?: ClientObjective | null;

  @IsOptional()
  @IsString()
  interest?: string | null;

  @IsOptional()
  @IsArray()
  objections?: string[] | null;

  @IsOptional()
  @IsIn(STATUSES)
  status?: ClientStatus | null;

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
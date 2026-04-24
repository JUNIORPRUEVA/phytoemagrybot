import { IsOptional, IsString } from 'class-validator';

export class MemoryResetAllDto {
  @IsOptional()
  @IsString()
  actor?: string;
}
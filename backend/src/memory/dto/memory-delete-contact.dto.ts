import { IsOptional, IsString } from 'class-validator';

export class MemoryDeleteContactDto {
  @IsString()
  contactId!: string;

  @IsOptional()
  @IsString()
  actor?: string;
}
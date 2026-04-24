import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ScheduleFollowupDto {
  @IsString()
  @IsNotEmpty()
  contactId!: string;

  @IsOptional()
  @IsString()
  outboundAddress?: string;

  @IsOptional()
  @IsString()
  reply?: string;

  @IsOptional()
  @IsDateString()
  nextFollowupAt?: string;
}
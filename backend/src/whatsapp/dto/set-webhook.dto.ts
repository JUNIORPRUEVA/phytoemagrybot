import { IsArray, IsOptional, IsString } from 'class-validator';

export class SetWebhookDto {
  @IsOptional()
  @IsString()
  webhook?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];
}
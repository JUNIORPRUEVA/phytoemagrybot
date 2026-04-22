import { IsOptional, IsString } from 'class-validator';

export class UpdateInstanceDto {
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}
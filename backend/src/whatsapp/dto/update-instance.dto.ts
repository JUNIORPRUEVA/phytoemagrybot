import { IsOptional, IsString } from '@nestjs/common';

export class UpdateInstanceDto {
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}
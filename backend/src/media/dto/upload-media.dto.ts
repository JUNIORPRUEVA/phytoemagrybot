import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadMediaDto {
  @IsString()
  @MaxLength(140)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
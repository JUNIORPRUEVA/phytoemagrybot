import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  identifier!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(120)
  password!: string;
}
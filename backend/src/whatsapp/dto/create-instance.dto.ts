import { IsNotEmpty, IsString } from 'class-validator';

export class CreateInstanceDto {
  @IsString()
  @IsNotEmpty()
  instanceName!: string;
}
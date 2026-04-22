import { IsNotEmpty, IsString } from 'class-validator';

export class ProcessIncomingMessageDto {
  @IsString()
  @IsNotEmpty()
  contactId!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;
}
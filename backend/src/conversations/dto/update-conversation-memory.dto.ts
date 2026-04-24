import { IsNotEmpty, IsString } from 'class-validator';
import { UpdateMemoryEntryDto } from '../../memory/dto/update-memory-entry.dto';

export class UpdateConversationMemoryDto extends UpdateMemoryEntryDto {
  @IsString()
  @IsNotEmpty()
  contactId!: string;
}
import { PartialType } from '@nestjs/mapped-types';
import { SaveConfigDto } from './create-client.dto';

export class UpdateConfigDto extends PartialType(SaveConfigDto) {}
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const MESSAGE_DIRECTIONS = ['user', 'assistant'] as const;

export class PostMessageDto {
  @IsString()
  @IsNotEmpty()
  contactId!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsIn(MESSAGE_DIRECTIONS)
  direction?: (typeof MESSAGE_DIRECTIONS)[number];

  @IsOptional()
  @IsString()
  outboundAddress?: string;

  @IsOptional()
  @IsBoolean()
  scheduleFollowup?: boolean;
}
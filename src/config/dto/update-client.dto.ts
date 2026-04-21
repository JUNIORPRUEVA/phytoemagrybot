import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateConfigDto {
	@IsString()
	@IsOptional()
	@MaxLength(120)
	openaiKey?: string;

	@IsString()
	@IsOptional()
	elevenlabsKey?: string;

	@IsString()
	@IsOptional()
	promptBase?: string;

	@IsObject()
	@IsOptional()
	configurations?: Record<string, unknown>;
}
import { Body, Controller, Get, Post } from '@nestjs/common';
import { SaveCompanyContextDto } from './dto/save-company-context.dto';
import { CompanyContextService } from './company-context.service';

@Controller('company-context')
export class CompanyContextController {
  constructor(private readonly companyContextService: CompanyContextService) {}

  @Get()
  async getContext() {
    return this.companyContextService.getContext();
  }

  @Post()
  async saveContext(@Body() dto: SaveCompanyContextDto) {
    return this.companyContextService.saveContext(dto);
  }
}
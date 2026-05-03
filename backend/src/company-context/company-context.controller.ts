import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { SaveCompanyContextDto } from './dto/save-company-context.dto';
import { CompanyContextService } from './company-context.service';
import { AuthenticatedRequest } from '../auth/auth.types';

@Controller('company-context')
export class CompanyContextController {
  constructor(private readonly companyContextService: CompanyContextService) {}

  @Get()
  async getContext(@Req() req: AuthenticatedRequest) {
    return this.companyContextService.getContext(req.user!.activeCompanyId);
  }

  @Post()
  async saveContext(@Req() req: AuthenticatedRequest, @Body() dto: SaveCompanyContextDto) {
    return this.companyContextService.saveContext(dto, req.user!.activeCompanyId);
  }
}

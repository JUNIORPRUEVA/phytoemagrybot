import { Module } from '@nestjs/common';
import { CompanyContextController } from './company-context.controller';
import { CompanyContextService } from './company-context.service';

@Module({
  controllers: [CompanyContextController],
  providers: [CompanyContextService],
  exports: [CompanyContextService],
})
export class CompanyContextModule {}
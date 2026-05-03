import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CompanyService } from './company.service';

@Module({
  imports: [PrismaModule],
  providers: [CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}

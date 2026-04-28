import { Module } from '@nestjs/common';
import { ToolsService } from './tools.service';
import { ToolsExecutor } from './tools.executor';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { CompanyContextModule } from '../company-context/company-context.module';

@Module({
  imports: [PrismaModule, ProductsModule, CompanyContextModule],
  providers: [ToolsService, ToolsExecutor],
  exports: [ToolsService, ToolsExecutor],
})
export class ToolsModule {}

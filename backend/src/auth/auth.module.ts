import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { CompanyModule } from '../company/company.module';
import { AdminSeedService } from './admin-seed.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CompanyScopeGuard } from './company-scope.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [UsersModule, CompanyModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AdminSeedService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CompanyScopeGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}

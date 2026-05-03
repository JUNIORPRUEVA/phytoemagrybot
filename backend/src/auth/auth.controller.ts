import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Public } from './public.decorator';
import { AuthenticatedRequest } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Public()
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.me(request.user!.userId);
  }

  @Get('companies')
  listMyCompanies(@Req() request: AuthenticatedRequest) {
    return this.authService.listMyCompanies(request.user!.userId);
  }

  @Post('switch-company/:companyId')
  switchCompany(
    @Req() request: AuthenticatedRequest,
    @Param('companyId') companyId: string,
  ) {
    return this.authService.switchCompany(request.user!.userId, companyId);
  }

  @Post('logout')
  logout() {
    return this.authService.logout();
  }
}

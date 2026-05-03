import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CompanyService } from '../company/company.service';
import { AuthenticatedRequest } from './auth.types';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Validates that:
 * 1. The authenticated user belongs to the company in their JWT (activeCompanyId).
 * 2. The company is not suspended.
 * 3. Injects the validated company id back into request.user so downstream
 *    services never need to trust a frontend-supplied company_id.
 */
@Injectable()
export class CompanyScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly companyService: CompanyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    // AuthGuard runs before this; user is already set
    if (!user) return true;

    const { userId, activeCompanyId } = user;

    if (!activeCompanyId) {
      throw new UnauthorizedException(
        'Tu sesión no tiene empresa asociada. Inicia sesión de nuevo.',
      );
    }

    // Validate membership – throws NotFoundException if not a member
    const role = await this.companyService.getCompanyUserRole(activeCompanyId, userId);
    if (!role) {
      throw new ForbiddenException('No tienes acceso a esta empresa.');
    }

    // Validate company status
    const company = await this.companyService.getById(activeCompanyId);
    if (company.status === 'suspended') {
      throw new ForbiddenException(
        'Esta empresa está suspendida. Contacta al soporte.',
      );
    }
    if (company.status === 'cancelled') {
      throw new ForbiddenException('Esta empresa ha sido cancelada.');
    }

    return true;
  }
}

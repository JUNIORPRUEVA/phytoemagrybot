import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from './auth.types';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = this.readAuthorizationHeader(request);
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Debes iniciar sesión.');
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Debes iniciar sesión.');
    }

    request.user = this.authService.verifyToken(token);
    return true;
  }

  private readAuthorizationHeader(request: AuthenticatedRequest): string {
    const headers = request.headers as unknown;

    if (headers && typeof (headers as { get?: unknown }).get === 'function') {
      return String((headers as { get(name: string): string | null }).get('authorization') ?? '');
    }

    if (!headers || typeof headers !== 'object') {
      return '';
    }

    const authorization = (headers as Record<string, unknown>).authorization;
    if (typeof authorization === 'string') {
      return authorization;
    }

    if (Array.isArray(authorization)) {
      return authorization.find((value): value is string => typeof value === 'string') ?? '';
    }

    return '';
  }
}
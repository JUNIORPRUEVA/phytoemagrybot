import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { UsersService } from '../users/users.service';
import { verifyPassword, hashPassword } from './password.util';
import { AuthTokenPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByIdentifier(dto.email);
    if (existing) {
      throw new ConflictException('El correo ya está registrado.');
    }

    if (dto.phone?.trim()) {
      const existingPhone = await this.usersService.findByIdentifier(dto.phone);
      if (existingPhone) {
        throw new ConflictException('El teléfono ya está registrado.');
      }
    }

    const role = (await this.usersService.countActiveUsers()) === 0
      ? UserRole.admin
      : UserRole.vendedor;

    const user = await this.usersService.create({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      password: dto.password,
      role,
      isActive: true,
    });

    return {
      user,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByIdentifier(dto.identifier);

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Usuario no encontrado.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('El usuario está inactivo.');
    }

    const validPassword = await verifyPassword(dto.password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedException('Contraseña incorrecta.');
    }

    return {
      token: this.signToken({
        userId: user.id,
        role: user.role,
        email: user.email,
      }),
      user: this.usersService.toPublicUser(user),
    };
  }

  async me(userId: string) {
    const user = await this.usersService.getActiveByIdOrThrow(userId);
    return this.usersService.toPublicUser(user);
  }

  logout() {
    return { ok: true };
  }

  verifyToken(token: string): AuthTokenPayload {
    try {
      const decoded = jwt.verify(token, this.getJwtSecret());
      if (!decoded || typeof decoded !== 'object') {
        throw new UnauthorizedException('Token inválido.');
      }

      const payload = decoded as AuthTokenPayload;
      if (!payload.userId || !payload.email || !payload.role) {
        throw new UnauthorizedException('Token inválido.');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Tu sesión expiró. Inicia sesión de nuevo.');
    }
  }

  private signToken(payload: AuthTokenPayload): string {
    return jwt.sign(payload, this.getJwtSecret(), { expiresIn: '7d' });
  }

  private getJwtSecret(): string {
    const secret = this.configService.get<string>('JWT_SECRET')?.trim();
    if (!secret) {
      throw new InternalServerErrorException('JWT secret is not configured');
    }

    return secret;
  }
}
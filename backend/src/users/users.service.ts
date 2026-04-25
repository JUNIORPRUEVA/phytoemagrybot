import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto): Promise<ReturnType<UsersService['toPublicUser']>> {
    const email = this.normalizeEmail(dto.email);
    const phone = this.normalizePhone(dto.phone);

    await this.ensureNoConflicts({ email, phone });

    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email,
        phone,
        passwordHash: await hashPassword(dto.password),
        role: dto.role,
        isActive: dto.isActive ?? true,
      },
    });

    return this.toPublicUser(user);
  }

  async list(): Promise<Array<ReturnType<UsersService['toPublicUser']>>> {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => this.toPublicUser(user));
  }

  async getByIdOrThrow(id: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    return user;
  }

  async getActiveByIdOrThrow(id: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, isActive: true },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<ReturnType<UsersService['toPublicUser']>> {
    const current = await this.getByIdOrThrow(id);
    const email = dto.email == null ? current.email : this.normalizeEmail(dto.email);
    const phone = dto.phone == null ? current.phone : this.normalizePhone(dto.phone);

    await this.ensureNoConflicts({ email, phone, excludeId: id });

    const data: Prisma.UserUpdateInput = {
      name: dto.name?.trim() ?? current.name,
      email,
      phone,
      role: dto.role ?? current.role,
      isActive: dto.isActive ?? current.isActive,
    };

    if (dto.password?.trim()) {
      data.passwordHash = await hashPassword(dto.password);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
    });

    return this.toPublicUser(user);
  }

  async softDelete(id: string): Promise<{ ok: true }> {
    await this.getByIdOrThrow(id);

    await this.prisma.user.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    return { ok: true };
  }

  async findByIdentifier(identifier: string): Promise<User | null> {
    const normalizedIdentifier = identifier.trim();
    if (!normalizedIdentifier) {
      return null;
    }

    const normalizedEmail = this.normalizeEmail(normalizedIdentifier);
    const normalizedPhone = this.normalizePhone(normalizedIdentifier);

    return this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { email: normalizedEmail },
          ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
        ],
      },
    });
  }

  toPublicUser(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
    };
  }

  async countActiveUsers(): Promise<number> {
    return this.prisma.user.count({
      where: { deletedAt: null },
    });
  }

  private async ensureNoConflicts(params: {
    email: string;
    phone?: string | null;
    excludeId?: string;
  }): Promise<void> {
    const conflicts = await this.prisma.user.findMany({
      where: {
        id: params.excludeId ? { not: params.excludeId } : undefined,
        OR: [
          { email: params.email },
          ...(params.phone ? [{ phone: params.phone }] : []),
        ],
      },
      select: {
        id: true,
        email: true,
        phone: true,
      },
      take: 5,
    });

    if (conflicts.some((user) => user.email === params.email)) {
      throw new ConflictException('El correo ya está registrado.');
    }

    if (params.phone && conflicts.some((user) => user.phone === params.phone)) {
      throw new ConflictException('El teléfono ya está registrado.');
    }
  }

  private normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
  }

  private normalizePhone(value?: string | null): string | null {
    const normalized = (value ?? '').trim();
    if (!normalized) {
      return null;
    }

    return normalized.replace(/[\s\-()]+/g, '');
  }
}
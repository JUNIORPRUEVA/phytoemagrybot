import assert from 'node:assert/strict';
import test from 'node:test';

import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { UserRole, type User } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { validateSync } from 'class-validator';

import { AuthGuard } from '../src/auth/auth.guard';
import { AuthService } from '../src/auth/auth.service';
import { LoginDto } from '../src/auth/dto/login.dto';
import { RegisterDto } from '../src/auth/dto/register.dto';
import { RolesGuard } from '../src/auth/roles.guard';
import { verifyPassword } from '../src/auth/password.util';
import { UsersService } from '../src/users/users.service';

type StoredUser = User;

function createUserRecord(data: {
  id?: string;
  name: string;
  email: string;
  phone?: string | null;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  deletedAt?: Date | null;
}): StoredUser {
  const now = new Date();
  return {
    id: data.id ?? `user-${Math.random().toString(36).slice(2, 10)}`,
    name: data.name,
    email: data.email,
    phone: data.phone ?? null,
    passwordHash: data.passwordHash,
    role: data.role,
    isActive: data.isActive,
    createdAt: now,
    updatedAt: now,
    deletedAt: data.deletedAt ?? null,
  };
}

function createServices() {
  const users: StoredUser[] = [];

  const prisma = {
    user: {
      async create({ data }: { data: Record<string, unknown> }) {
        const user = createUserRecord({
          name: String(data.name),
          email: String(data.email),
          phone: (data.phone as string | null | undefined) ?? null,
          passwordHash: String(data.passwordHash),
          role: data.role as UserRole,
          isActive: Boolean(data.isActive),
        });
        users.push(user);
        return user;
      },
      async findMany({ where, take }: { where?: Record<string, any>; take?: number }) {
        let results = users.filter((user) => matchesWhere(user, where));
        if (typeof take === 'number') {
          results = results.slice(0, take);
        }
        return results;
      },
      async findFirst({ where }: { where?: Record<string, any> }) {
        return users.find((user) => matchesWhere(user, where)) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const index = users.findIndex((item) => item.id === where.id);
        if (index < 0) {
          throw new Error('User not found');
        }
        users[index] = {
          ...users[index],
          ...data,
          updatedAt: new Date(),
        } as StoredUser;
        return users[index];
      },
      async count({ where }: { where?: Record<string, any> }) {
        return users.filter((user) => matchesWhere(user, where)).length;
      },
    },
  };

  const usersService = new UsersService(prisma as any);
  const authService = new AuthService(
    { get: (key: string) => (key === 'JWT_SECRET' ? 'test-jwt-secret' : undefined) } as any,
    usersService,
  );

  return { users, usersService, authService };
}

function matchesWhere(user: StoredUser, where?: Record<string, any>): boolean {
  if (!where) {
    return true;
  }

  if (where.id?.not && user.id === where.id.not) {
    return false;
  }
  if (where.id && typeof where.id === 'string' && user.id !== where.id) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(where, 'deletedAt') && user.deletedAt !== where.deletedAt) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(where, 'isActive') && user.isActive !== where.isActive) {
    return false;
  }

  if (Array.isArray(where.OR) && where.OR.length > 0) {
    const orMatched = where.OR.some((clause) => matchesWhere(user, clause));
    if (!orMatched) {
      return false;
    }
  }

  if (where.email && user.email !== where.email) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(where, 'phone') && user.phone !== where.phone) {
    return false;
  }

  return true;
}

function createContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function handler() {},
    getClass: () => class TestClass {},
  } as any;
}

test('register creates the first user as admin, hashes the password, and normalizes identifiers', async () => {
  const { authService, users } = createServices();

  const result = await authService.register({
    name: 'Admin Demo',
    email: 'ADMIN@PHYTO.COM',
    phone: '(809) 555-1234',
    password: 'SuperSecreta1',
  });

  assert.equal(result.user.email, 'admin@phyto.com');
  assert.equal(result.user.phone, '8095551234');
  assert.equal(result.user.role, UserRole.admin);
  assert.equal(users.length, 1);
  assert.notEqual(users[0].passwordHash, 'SuperSecreta1');
  assert.equal(await verifyPassword('SuperSecreta1', users[0].passwordHash), true);
});

test('register rejects duplicate email and duplicate phone', async () => {
  const { authService } = createServices();

  await authService.register({
    name: 'Admin Demo',
    email: 'admin@phyto.com',
    phone: '8095551234',
    password: 'SuperSecreta1',
  });

  await assert.rejects(
    authService.register({
      name: 'Duplicado',
      email: 'ADMIN@PHYTO.COM',
      phone: '8098889999',
      password: 'SuperSecreta1',
    }),
    (error: unknown) => error instanceof ConflictException && error.message === 'El correo ya está registrado.',
  );

  await assert.rejects(
    authService.register({
      name: 'Duplicado',
      email: 'otro@phyto.com',
      phone: '(809) 555-1234',
      password: 'SuperSecreta1',
    }),
    (error: unknown) => error instanceof ConflictException && error.message === 'El teléfono ya está registrado.',
  );
});

test('login works with email and phone, returns a valid JWT, and keeps 7 day expiry', async () => {
  const { authService } = createServices();

  const registered = await authService.register({
    name: 'Ventas Demo',
    email: 'ventas@phyto.com',
    phone: '809-555-1234',
    password: 'SuperSecreta1',
  });

  const emailSession = await authService.login({
    identifier: 'ventas@phyto.com',
    password: 'SuperSecreta1',
  });
  const phoneSession = await authService.login({
    identifier: '8095551234',
    password: 'SuperSecreta1',
  });

  const payload = jwt.verify(emailSession.token, 'test-jwt-secret') as jwt.JwtPayload;

  assert.equal(emailSession.user.id, registered.user.id);
  assert.equal(phoneSession.user.id, registered.user.id);
  assert.equal(payload.userId, registered.user.id);
  assert.equal(payload.email, 'ventas@phyto.com');
  assert.equal(payload.role, UserRole.admin);
  assert.equal((payload.exp ?? 0) - (payload.iat ?? 0), 60 * 60 * 24 * 7);
  assert.deepEqual(authService.verifyToken(emailSession.token), {
    userId: registered.user.id,
    email: 'ventas@phyto.com',
    role: UserRole.admin,
    iat: payload.iat,
    exp: payload.exp,
  });
});

test('login rejects unknown user, wrong password, and invalid token', async () => {
  const { authService } = createServices();

  await authService.register({
    name: 'Soporte Demo',
    email: 'soporte@phyto.com',
    phone: '8095550000',
    password: 'SuperSecreta1',
  });

  await assert.rejects(
    authService.login({ identifier: 'missing@phyto.com', password: 'SuperSecreta1' }),
    (error: unknown) => error instanceof UnauthorizedException && error.message === 'Usuario no encontrado.',
  );

  await assert.rejects(
    authService.login({ identifier: 'soporte@phyto.com', password: 'otra-clave-123' }),
    (error: unknown) => error instanceof UnauthorizedException && error.message === 'Contraseña incorrecta.',
  );

  assert.throws(
    () => authService.verifyToken('not-a-real-token'),
    (error: unknown) => error instanceof UnauthorizedException && error.message === 'Tu sesión expiró. Inicia sesión de nuevo.',
  );
});

test('auth guard reads bearer token and roles guard enforces admin access', async () => {
  const { authService } = createServices();
  const registered = await authService.register({
    name: 'Admin Demo',
    email: 'admin@phyto.com',
    phone: '8095551234',
    password: 'SuperSecreta1',
  });
  const session = await authService.login({
    identifier: 'admin@phyto.com',
    password: 'SuperSecreta1',
  });

  const request = { headers: new Headers({ authorization: `Bearer ${session.token}` }) };
  const authGuard = new AuthGuard(
    { getAllAndOverride: () => false } as any,
    authService,
  );

  assert.equal(authGuard.canActivate(createContext(request)), true);
  assert.equal((request as any).user.userId, registered.user.id);

  const rolesGuard = new RolesGuard({ getAllAndOverride: () => [UserRole.admin] } as any);
  assert.equal(rolesGuard.canActivate(createContext({ user: { role: UserRole.admin } })), true);
  assert.throws(
    () => rolesGuard.canActivate(createContext({ user: { role: UserRole.vendedor } })),
    /No tienes permisos para realizar esta acción\./,
  );
});

test('auth DTO validation rejects invalid email, short password, and too-short identifier', () => {
  const registerDto = Object.assign(new RegisterDto(), {
    name: 'A',
    email: 'correo-invalido',
    password: '123',
  });
  const loginDto = Object.assign(new LoginDto(), {
    identifier: 'ab',
    password: '123',
  });

  const registerErrors = validateSync(registerDto);
  const loginErrors = validateSync(loginDto);

  assert.equal(registerErrors.length > 0, true);
  assert.equal(loginErrors.length > 0, true);
  assert.equal(registerErrors.some((error) => error.property === 'email'), true);
  assert.equal(registerErrors.some((error) => error.property === 'password'), true);
  assert.equal(loginErrors.some((error) => error.property === 'identifier'), true);
  assert.equal(loginErrors.some((error) => error.property === 'password'), true);
});
import assert from 'node:assert/strict';
import test from 'node:test';

import { InternalServerErrorException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AdminSeedService } from '../src/auth/admin-seed.service';

function createService(options?: {
  env?: Record<string, string | undefined>;
  activeUsers?: number;
}) {
  const createdUsers: Array<Record<string, unknown>> = [];
  const config = new Map<string, string | undefined>(Object.entries(options?.env ?? {}));
  const usersService = {
    countActiveUsers: async () => options?.activeUsers ?? 0,
    create: async (dto: Record<string, unknown>) => {
      createdUsers.push(dto);
      return {
        id: 'user-1',
        ...dto,
      };
    },
  };

  const service = new AdminSeedService(
    {
      get: (key: string) => config.get(key),
    } as any,
    usersService as any,
  );

  return {
    service,
    createdUsers,
  };
}

test('admin seed creates the first admin only when enabled and the database is empty', async () => {
  const { service, createdUsers } = createService({
    env: {
      ADMIN_SEED_ENABLED: 'true',
      ADMIN_SEED_NAME: 'Admin Cloud',
      ADMIN_SEED_EMAIL: 'admin@phyto.com',
      ADMIN_SEED_PHONE: '8095551234',
      ADMIN_SEED_PASSWORD: 'SuperSecreta1',
    },
    activeUsers: 0,
  });

  await service.onModuleInit();

  assert.equal(createdUsers.length, 1);
  assert.deepEqual(createdUsers[0], {
    name: 'Admin Cloud',
    email: 'admin@phyto.com',
    phone: '8095551234',
    password: 'SuperSecreta1',
    role: UserRole.admin,
    isActive: true,
  });
});

test('admin seed skips creation when users already exist', async () => {
  const { service, createdUsers } = createService({
    env: {
      ADMIN_SEED_ENABLED: 'true',
      ADMIN_SEED_NAME: 'Admin Cloud',
      ADMIN_SEED_EMAIL: 'admin@phyto.com',
      ADMIN_SEED_PASSWORD: 'SuperSecreta1',
    },
    activeUsers: 2,
  });

  await service.onModuleInit();

  assert.equal(createdUsers.length, 0);
});

test('admin seed does nothing when disabled', async () => {
  const { service, createdUsers } = createService({
    env: {
      ADMIN_SEED_ENABLED: 'false',
      ADMIN_SEED_NAME: 'Admin Cloud',
      ADMIN_SEED_EMAIL: 'admin@phyto.com',
      ADMIN_SEED_PASSWORD: 'SuperSecreta1',
    },
  });

  await service.onModuleInit();

  assert.equal(createdUsers.length, 0);
});

test('admin seed fails fast when enabled but required env vars are missing', async () => {
  const { service, createdUsers } = createService({
    env: {
      ADMIN_SEED_ENABLED: 'true',
      ADMIN_SEED_NAME: 'Admin Cloud',
      ADMIN_SEED_EMAIL: 'admin@phyto.com',
    },
  });

  await assert.rejects(
    service.onModuleInit(),
    (error: unknown) => error instanceof InternalServerErrorException,
  );
  assert.equal(createdUsers.length, 0);
});
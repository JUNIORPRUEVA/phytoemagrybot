import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

function isLocalHost(host?: string): boolean {
  const value = (host || '').trim().toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '0.0.0.0' || value === 'postgres' || value === 'redis';
}

function parseUrlInfo(url: string): { host?: string; protocol?: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname, protocol: parsed.protocol };
  } catch {
    return {};
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
  const redisUrl = process.env.REDIS_URL?.trim() ?? '';
  const storageEndpoint = process.env.STORAGE_ENDPOINT?.trim() ?? '';

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!redisUrl) throw new Error('REDIS_URL is required');
  if (!storageEndpoint) throw new Error('STORAGE_ENDPOINT is required');

  const dbInfo = parseUrlInfo(databaseUrl);
  const redisInfo = parseUrlInfo(redisUrl);
  const storageInfo = parseUrlInfo(storageEndpoint);

  if (isLocalHost(dbInfo.host)) throw new Error(`DB must be cloud (host=${dbInfo.host})`);
  if (isLocalHost(redisInfo.host)) throw new Error(`Redis must be cloud (host=${redisInfo.host})`);
  if (isLocalHost(storageInfo.host)) throw new Error(`Storage must be cloud (host=${storageInfo.host})`);

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });

  try {
    await prisma.$connect();
    await prisma.$queryRawUnsafe('SELECT 1');
    console.log('CLOUD DB CONNECTED');

    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error(`Unexpected Redis ping response: ${pong}`);
    }
    console.log('CLOUD REDIS CONNECTED');

    console.log('CLOUD STORAGE ACTIVE');
    console.log('Selftest OK');
  } finally {
    await prisma.$disconnect();
    await redis.quit();
  }
}

main().catch((error) => {
  console.error('Selftest failed:', error);
  process.exitCode = 1;
});

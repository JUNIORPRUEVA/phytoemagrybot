import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { StoredMessage } from '../memory/memory.types';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  private static readonly GROUPED_TEXT_FLUSH_ZSET_KEY = 'grouped-text:flush:due';

  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL')?.trim() ?? '';

    if (!redisUrl) {
      throw new Error('Missing required environment variable REDIS_URL');
    }

    const info = this.getRedisInfo(redisUrl);
    if (this.isLocalHost(info.host)) {
      throw new Error(`Refusing to start with a local REDIS_URL (host=${info.host ?? '?'})`);
    }

    const options: RedisOptions = {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    };

    this.client = new Redis(redisUrl, options);

    this.client.on('ready', () => {
      this.logger.log(
        `CLOUD REDIS CONNECTED (host=${info.host ?? '?'}, port=${info.port ?? '?'}, tls=${info.tls})`,
      );
    });

    this.client.on('error', (error) => {
      this.logger.error('Redis connection error', error.stack);
    });
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const serialized = this.serialize(value);

    if (ttl && ttl > 0) {
      await this.client.set(key, serialized, 'EX', ttl);
      return;
    }

    await this.client.set(key, serialized);
  }

  async setIfAbsent(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    const serialized = this.serialize(value);
    const result = await this.client.set(key, serialized, 'EX', Math.max(ttlSeconds, 1), 'NX');
    return result === 'OK';
  }

  async increment(key: string, ttlSeconds?: number): Promise<number> {
    const value = await this.client.incr(key);

    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.expire(key, ttlSeconds);
    }

    return value;
  }

  async get<T = string>(key: string): Promise<T | null> {
    const value = await this.client.get(key);

    if (value === null) {
      return null;
    }

    return this.deserialize<T>(value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async deleteMany(keys: string[]): Promise<void> {
    const normalizedKeys = keys
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

    if (normalizedKeys.length === 0) {
      return;
    }

    await this.client.del(...normalizedKeys);
  }

  async deleteByPattern(pattern: string): Promise<number> {
    const normalizedPattern = pattern.trim();
    if (normalizedPattern.length === 0) {
      return 0;
    }

    let cursor = '0';
    let deleted = 0;

    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'MATCH',
        normalizedPattern,
        'COUNT',
        '100',
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        deleted += await this.client.del(...keys);
      }
    } while (cursor !== '0');

    return deleted;
  }

  async pushToList(key: string, value: unknown): Promise<void> {
    await this.client.lpush(key, this.serialize(value));
  }

  async getList<T = string>(key: string): Promise<T[]> {
    const values = await this.client.lrange(key, 0, -1);
    return values.reverse().map((value) => this.deserialize<T>(value));
  }

  async clearList(key: string): Promise<void> {
    await this.client.del(key);
  }

  async appendConversationMessage(
    contactId: string,
    message: StoredMessage,
    limit = 20,
    ttlSeconds = 60 * 60 * 24,
  ): Promise<StoredMessage[]> {
    const bufferKey = this.getConversationBufferKey(contactId);
    const cacheKey = this.getConversationCacheKey(contactId);

    await this.client.lpush(bufferKey, this.serialize(message));
    await this.client.ltrim(bufferKey, 0, Math.max(limit - 1, 0));
    await this.client.expire(bufferKey, ttlSeconds);

    const messages = await this.getConversationMessages(contactId, limit);
    await this.client.set(cacheKey, this.serialize(messages), 'EX', ttlSeconds);
    return messages;
  }

  async setConversationMessages(
    contactId: string,
    messages: StoredMessage[],
    ttlSeconds = 60 * 60 * 24,
  ): Promise<void> {
    const bufferKey = this.getConversationBufferKey(contactId);
    const cacheKey = this.getConversationCacheKey(contactId);

    const pipeline = this.client.pipeline();
    pipeline.del(bufferKey);

    const recent = messages.slice(-20);
    for (const message of recent) {
      pipeline.rpush(bufferKey, this.serialize(message));
    }

    pipeline.expire(bufferKey, ttlSeconds);
    pipeline.set(cacheKey, this.serialize(recent), 'EX', ttlSeconds);
    await pipeline.exec();
  }

  async getConversationMessages(contactId: string, limit = 10): Promise<StoredMessage[]> {
    const cacheKey = this.getConversationCacheKey(contactId);
    const cached = await this.get<StoredMessage[]>(cacheKey);
    if (Array.isArray(cached) && cached.length > 0) {
      return cached.slice(-limit);
    }

    const values = await this.client.lrange(this.getConversationBufferKey(contactId), 0, limit - 1);
    return values.reverse().map((value) => this.deserialize<StoredMessage>(value));
  }

  async appendGroupedMessage(
    contactId: string,
    message: string,
    windowMs: number,
    outboundAddress?: string,
  ): Promise<boolean> {
    const bufferKey = this.getGroupedBufferKey(contactId);
    const recipientKey = this.getGroupedRecipientKey(contactId);
    const timerKey = this.getGroupedTimerKey(contactId);
    const current = await this.client.get(bufferKey);
    const nextMessage = current ? `${current}\n${message}` : message;
    const ttlMs = Math.max(windowMs * 3, 6000);

    await this.client.set(bufferKey, nextMessage, 'PX', ttlMs);
    if (outboundAddress?.trim()) {
      await this.client.set(recipientKey, outboundAddress.trim(), 'PX', ttlMs);
    }
    const lockResult = await this.client.set(timerKey, '1', 'PX', windowMs, 'NX');

    return lockResult === 'OK';
  }

  async consumeGroupedMessage(
    contactId: string,
  ): Promise<{ message: string; outboundAddress: string | null } | null> {
    const bufferKey = this.getGroupedBufferKey(contactId);
    const recipientKey = this.getGroupedRecipientKey(contactId);
    const value = await this.client.get(bufferKey);

    if (value === null) {
      return null;
    }

    const outboundAddress = await this.client.get(recipientKey);

    await this.client.del(bufferKey);
    await this.client.del(recipientKey);
    return {
      message: value,
      outboundAddress,
    };
  }

  async scheduleGroupedTextFlush(contactId: string, delayMs: number): Promise<void> {
    const normalizedContactId = contactId.trim();
    if (!normalizedContactId) {
      return;
    }

    const now = Date.now();
    const score = now + Math.max(delayMs, 0);

    await this.client.zadd(
      RedisService.GROUPED_TEXT_FLUSH_ZSET_KEY,
      String(score),
      normalizedContactId,
    );
  }

  async popDueGroupedTextFlushContacts(limit = 50): Promise<string[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const now = Date.now();

    const script = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local limit = tonumber(ARGV[2])
      local ids = redis.call('ZRANGEBYSCORE', key, '-inf', now, 'LIMIT', 0, limit)
      if (#ids == 0) then
        return ids
      end
      redis.call('ZREM', key, unpack(ids))
      return ids
    `;

    const result = await this.client.eval(
      script,
      1,
      RedisService.GROUPED_TEXT_FLUSH_ZSET_KEY,
      String(now),
      String(safeLimit),
    );

    return Array.isArray(result) ? result.map((value) => String(value)) : [];
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch (error) {
      this.logger.warn(
        `Redis ping failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  private serialize(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    return JSON.stringify(value);
  }

  private deserialize<T>(value: string): T {
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  private getConversationBufferKey(contactId: string): string {
    return `buffer:${contactId}`;
  }

  private getConversationCacheKey(contactId: string): string {
    return `cache:${contactId}`;
  }

  private getGroupedBufferKey(contactId: string): string {
    return `grouped-buffer:${contactId}`;
  }

  private getGroupedTimerKey(contactId: string): string {
    return `grouped-buffer:timer:${contactId}`;
  }

  private getGroupedRecipientKey(contactId: string): string {
    return `grouped-buffer:recipient:${contactId}`;
  }

  private parseBoolean(value: string | undefined): boolean {
    if (!value) {
      return false;
    }

    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
  }

  private getRedisInfo(url: string): { host?: string; port?: number; tls: boolean } {
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : undefined,
        tls: parsed.protocol === 'rediss:',
      };
    } catch {
      return { tls: false };
    }
  }

  private isLocalHost(host?: string): boolean {
    const normalized = (host || '').trim().toLowerCase();
    return (
      normalized === 'localhost' ||
      normalized === '127.0.0.1' ||
      normalized === '0.0.0.0' ||
      normalized === 'redis'
    );
  }
}
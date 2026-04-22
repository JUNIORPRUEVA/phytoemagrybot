import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('REDIS_HOST') ?? '127.0.0.1';
    const port = Number(this.configService.get<string>('REDIS_PORT') ?? 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD')?.trim();
    const tlsEnabled = this.parseBoolean(this.configService.get<string>('REDIS_TLS'));

    const options: RedisOptions = {
      host,
      port,
      maxRetriesPerRequest: null,
      lazyConnect: false,
    };

    if (password) {
      options.password = password;
    }

    if (tlsEnabled) {
      options.tls = {};
    }

    this.client = new Redis(options);

    this.client.on('ready', () => {
      this.logger.log(`Redis ready at ${host}:${port}`);
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

  async appendGroupedMessage(
    contactId: string,
    message: string,
    windowMs: number,
  ): Promise<boolean> {
    const bufferKey = this.getBufferKey(contactId);
    const timerKey = this.getTimerKey(contactId);
    const current = await this.client.get(bufferKey);
    const nextMessage = current ? `${current}\n${message}` : message;

    await this.client.set(bufferKey, nextMessage, 'PX', Math.max(windowMs * 3, 6000));
    const lockResult = await this.client.set(timerKey, '1', 'PX', windowMs, 'NX');

    return lockResult === 'OK';
  }

  async consumeGroupedMessage(contactId: string): Promise<string | null> {
    const bufferKey = this.getBufferKey(contactId);
    const value = await this.client.get(bufferKey);

    if (value === null) {
      return null;
    }

    await this.client.del(bufferKey);
    return value;
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

  private getBufferKey(contactId: string): string {
    return `buffer:${contactId}`;
  }

  private getTimerKey(contactId: string): string {
    return `buffer:timer:${contactId}`;
  }

  private parseBoolean(value: string | undefined): boolean {
    if (!value) {
      return false;
    }

    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
}
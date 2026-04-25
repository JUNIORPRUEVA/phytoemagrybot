import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      this.enforceCloudDatabaseIfRequired();
      await this.$connect();
      const info = this.getDatabaseInfo();
      this.logger.log(
        `CLOUD DB CONNECTED (host=${info.host}, db=${info.database}, schema=${info.schema ?? 'public'})`,
      );
    } catch (error) {
      this.logger.error(
        'Prisma connection failed',
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('Database connection failed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.$queryRawUnsafe('SELECT 1');
      return true;
    } catch (error) {
      this.logger.warn(
        `Prisma health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  private enforceCloudDatabaseIfRequired(): void {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is empty');
    }

    const info = this.getDatabaseInfo(url);
    const host = (info.host || '').toLowerCase();

    const isLocalHost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === 'postgres';

    if (isLocalHost) {
      throw new Error(`Refusing to start with a local DATABASE_URL (host=${info.host}).`);
    }
  }

  private getDatabaseInfo(input?: string): { host?: string; database?: string; schema?: string } {
    const url = input ?? process.env.DATABASE_URL;
    if (!url) {
      return {};
    }

    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      const database = parsed.pathname?.replace(/^\//, '') || undefined;
      const schema = parsed.searchParams.get('schema') || undefined;
      return { host, database, schema };
    } catch {
      return {};
    }
  }
}
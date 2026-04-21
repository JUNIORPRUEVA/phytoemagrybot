import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Prisma connected');
    } catch (error) {
      this.logger.error(
        'Prisma connection failed',
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('Database connection failed');
    }
  }
}
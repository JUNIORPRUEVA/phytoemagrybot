import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { UsersService } from '../users/users.service';

@Injectable()
export class AdminSeedService implements OnModuleInit {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isSeedEnabled()) {
      return;
    }

    const activeUsers = await this.usersService.countActiveUsers();

    if (activeUsers > 0) {
      this.logger.log('Admin seed skipped because users already exist');
      return;
    }

    const seedConfig = this.getSeedConfig();

    try {
      await this.usersService.create({
        name: seedConfig.name,
        email: seedConfig.email,
        phone: seedConfig.phone,
        password: seedConfig.password,
        role: UserRole.admin,
        isActive: true,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        this.logger.warn(
          `Admin seed skipped because another instance created ${seedConfig.email} first`,
        );
        return;
      }

      throw error;
    }

    this.logger.log(`Initial admin user created for ${seedConfig.email}`);
  }

  private isSeedEnabled(): boolean {
    const rawValue = this.configService.get<string>('ADMIN_SEED_ENABLED')?.trim().toLowerCase();
    return rawValue === 'true' || rawValue === '1' || rawValue === 'yes';
  }

  private getSeedConfig(): {
    name: string;
    email: string;
    phone?: string;
    password: string;
  } {
    const name = this.configService.get<string>('ADMIN_SEED_NAME')?.trim() ?? '';
    const email = this.configService.get<string>('ADMIN_SEED_EMAIL')?.trim() ?? '';
    const password = this.configService.get<string>('ADMIN_SEED_PASSWORD')?.trim() ?? '';
    const phone = this.configService.get<string>('ADMIN_SEED_PHONE')?.trim() ?? '';

    if (!name || !email || !password) {
      throw new InternalServerErrorException(
        'Admin seed is enabled but ADMIN_SEED_NAME, ADMIN_SEED_EMAIL, or ADMIN_SEED_PASSWORD is missing',
      );
    }

    return {
      name,
      email,
      password,
      phone: phone || undefined,
    };
  }
}
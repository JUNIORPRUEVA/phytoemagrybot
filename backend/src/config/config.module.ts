import { Module } from '@nestjs/common';
import { ClientConfigController } from './config.controller';
import { ClientConfigService } from './config.service';

@Module({
  controllers: [ClientConfigController],
  providers: [ClientConfigService],
  exports: [ClientConfigService],
})
export class ClientConfigModule {}
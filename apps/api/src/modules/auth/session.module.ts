import { Module } from '@nestjs/common';
import { SessionService } from './services/session.service';

/**
 * Provides SessionService as a standalone module.
 * Both AuthModule and UserModule import this to avoid circular dependencies.
 * SessionService only depends on REDIS_CLIENT which is @Global.
 */
@Module({
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}

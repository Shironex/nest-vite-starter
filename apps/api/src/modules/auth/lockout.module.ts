import { Module } from '@nestjs/common';
import { LockoutRepository } from './repositories/lockout.repository';
import { LockoutService } from './services/lockout.service';

/**
 * Provides LockoutService (and its LockoutRepository) as a standalone module.
 * Both AuthModule (LoginService) and UserModule (UserRouter.adminUnlock) inject
 * LockoutService, so it lives here to avoid the AuthModule ↔ UserModule cycle:
 * the same cycle-breaker pattern as SessionModule and AuthMiddlewareModule.
 * LockoutRepository depends only on the @Global PrismaService.
 */
@Module({
  providers: [LockoutRepository, LockoutService],
  exports: [LockoutService],
})
export class LockoutModule {}

import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';
import { UserRouter } from './user.router';
import { UserPurgeService } from './user-purge.service';
import { SessionModule } from '../auth/session.module';
import { AuthMiddlewareModule } from '../auth/auth-middleware.module';
import { LockoutModule } from '../auth/lockout.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';

/**
 * UserModule imports AuthMiddlewareModule (not AuthModule) so its routers
 * can use `@UseMiddlewares(AuthMiddleware)` without pulling in AuthService,
 * which itself depends on UserService. That asymmetric split is what breaks
 * the previous AuthModule ↔ UserModule cycle without `forwardRef`.
 *
 * LockoutModule is imported the same way: UserRouter.adminUnlock injects
 * LockoutService, and routing it through the standalone module keeps the
 * cycle broken (importing AuthModule directly would reintroduce it).
 *
 * IdempotencyModule provides the IdempotencyMiddleware that UserRouter wires
 * method-level after auth on its mutations.
 */
@Module({
  imports: [SessionModule, AuthMiddlewareModule, LockoutModule, IdempotencyModule],
  providers: [UserRepository, UserService, UserRouter, UserPurgeService],
  exports: [UserService, UserRepository],
})
export class UserModule {}

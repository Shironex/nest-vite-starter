import { Module } from '@nestjs/common';
import { SessionModule } from './session.module';
import { AuthMiddleware } from './middleware/auth.middleware';
import { AdminMiddleware } from './middleware/role.middleware';
import { ManageUsersMiddleware } from './middleware/permission.middleware';
import { TwoFactorEnrollmentModule } from './two-factor-enrollment.module';

/**
 * Provides the tRPC auth middlewares (AuthMiddleware, AdminMiddleware,
 * ManageUsersMiddleware). Mirrors the SessionModule cycle-breaker pattern:
 * routers in feature modules (UserModule, StorageModule, AuthModule) need
 * `@UseMiddlewares(AuthMiddleware)`, and AuthService needs UserService for
 * data lookups. Keeping the middleware providers in their own module breaks
 * the AuthModule ↔ UserModule cycle that previously required `forwardRef`.
 *
 * Dependencies: SessionModule for AuthMiddleware; PrismaModule and RedisModule
 * are global so PermissionMiddleware resolves them implicitly.
 * TwoFactorEnrollmentModule supplies the TwoFactorEnrollmentReader (only needs
 * the global PrismaService) so AuthMiddleware can re-derive a stale enroll-only
 * flag without importing the heavy AuthModule and reopening the cycle.
 */
@Module({
  imports: [SessionModule, TwoFactorEnrollmentModule],
  providers: [AuthMiddleware, AdminMiddleware, ManageUsersMiddleware],
  exports: [AuthMiddleware, AdminMiddleware, ManageUsersMiddleware],
})
export class AuthMiddlewareModule {}

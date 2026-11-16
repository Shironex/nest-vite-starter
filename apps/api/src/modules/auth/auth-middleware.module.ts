import { Module } from '@nestjs/common';
import { SessionModule } from './session.module';
import { AuthMiddleware } from './middleware/auth.middleware';
import { AdminMiddleware } from './middleware/role.middleware';
import { ManageUsersMiddleware } from './middleware/permission.middleware';

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
 */
@Module({
  imports: [SessionModule],
  providers: [AuthMiddleware, AdminMiddleware, ManageUsersMiddleware],
  exports: [AuthMiddleware, AdminMiddleware, ManageUsersMiddleware],
})
export class AuthMiddlewareModule {}

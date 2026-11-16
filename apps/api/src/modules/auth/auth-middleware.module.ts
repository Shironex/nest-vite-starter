import { Module } from '@nestjs/common';
import { SessionModule } from './session.module';
import { AuthMiddleware } from './middleware/auth.middleware';
import { AdminMiddleware } from './middleware/role.middleware';

/**
 * Provides the tRPC auth middlewares (AuthMiddleware, AdminMiddleware). Mirrors the SessionModule cycle-breaker pattern:
 * routers in feature modules (UserModule, AuthModule) need
 * `@UseMiddlewares(AuthMiddleware)`, and AuthService needs UserService for
 * data lookups. Keeping the middleware providers in their own module breaks
 * the AuthModule ↔ UserModule cycle that previously required `forwardRef`.
 *
 * Dependencies: SessionModule for AuthMiddleware.
 */
@Module({
  imports: [SessionModule],
  providers: [AuthMiddleware, AdminMiddleware],
  exports: [AuthMiddleware, AdminMiddleware],
})
export class AuthMiddlewareModule {}

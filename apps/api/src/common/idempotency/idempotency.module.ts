import { Module } from '@nestjs/common';
import { IdempotencyMiddleware } from './idempotency.middleware';

/**
 * Provides the IdempotencyMiddleware for method-level wiring on mutation
 * routers (`@UseMiddlewares(AuthMiddleware, ..., IdempotencyMiddleware)`).
 * Each module whose router uses the middleware imports this module; a global
 * `TRPCModule.forRoot` registration would run before AuthMiddleware and
 * no-op (see idempotency.middleware.ts).
 *
 * Not `@Global()`: explicit imports keep the consumer set visible.
 */
@Module({
  providers: [IdempotencyMiddleware],
  exports: [IdempotencyMiddleware],
})
export class IdempotencyModule {}

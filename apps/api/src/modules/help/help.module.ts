import { Module } from '@nestjs/common';
import { SessionModule } from '../auth/session.module';
import { AuthMiddlewareModule } from '../auth/auth-middleware.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { HelpRouter } from './help.router';
import { TourProgressRepository } from './tour-progress.repository';
import { TourProgressService } from './tour-progress.service';

/**
 * In-app help. Imports the cycle-breaker pair (SessionModule +
 * AuthMiddlewareModule) so the router can use `@UseMiddlewares(AuthMiddleware)`,
 * and IdempotencyModule for the method-level IdempotencyMiddleware on
 * progressSave. PrismaService is available globally (PrismaModule is @Global).
 *
 * Exports nothing: tour progress is read and written by exactly one surface,
 * and a service nobody else consumes should not advertise itself.
 */
@Module({
  imports: [SessionModule, AuthMiddlewareModule, IdempotencyModule],
  providers: [TourProgressRepository, TourProgressService, HelpRouter],
})
export class HelpModule {}

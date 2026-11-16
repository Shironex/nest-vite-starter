import { Module } from '@nestjs/common';
import { SessionModule } from '../auth/session.module';
import { AuthMiddlewareModule } from '../auth/auth-middleware.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { NotificationDispatchQueueModule } from './notification-dispatch/notification-dispatch-queue.module';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { NotificationsRouter } from './notifications.router';
import { NotificationRetentionService } from './notification-retention.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationEventsService } from './notification-events.service';

/**
 * Producer + read side of notifications. Imports the cycle-breaker pair
 * (SessionModule + AuthMiddlewareModule) so the router can use
 * `@UseMiddlewares(AuthMiddleware)`, and the queue-only
 * NotificationDispatchQueueModule so `NotificationsService.notify` can
 * enqueue. Deliberately does NOT import EventsModule or the processor's
 * NotificationDispatchModule: EventsModule imports THIS module (the gateway's
 * test-notification trigger), so an EventsModule import here would close a
 * cycle. The processor gets its EventsService in NotificationDispatchModule,
 * which sits downstream of both.
 *
 * IdempotencyModule backs the method-level IdempotencyMiddleware on
 * preferencesUpdate (a lazily row-creating settings save, like
 * compliance.settingsUpdate).
 *
 * Exports NotificationsService (EventsGateway, future feature producers),
 * NotificationsRepository (the dispatch processor's persist step) and
 * NotificationPreferencesService (event producers filter their recipients
 * through it). PrismaService is available globally (PrismaModule
 * is `@Global`).
 */
@Module({
  imports: [
    SessionModule,
    AuthMiddlewareModule,
    IdempotencyModule,
    NotificationDispatchQueueModule,
  ],
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationsRouter,
    NotificationRetentionService,
    NotificationPreferencesService,
    NotificationEventsService,
  ],
  exports: [
    NotificationsService,
    NotificationsRepository,
    NotificationPreferencesService,
    NotificationEventsService,
  ],
})
export class NotificationsModule {}

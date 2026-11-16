import { Module } from '@nestjs/common';
import { SessionModule } from '../auth/session.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsGateway } from './events.gateway';
import { EventsService } from './events.service';
import { SessionRevocationService } from './session-revocation.service';

/**
 * NotificationsModule is imported for the gateway's dev TEST_NOTIFICATION
 * trigger (NotificationsService.sendTestNotification enqueues onto the
 * notification-dispatch queue). The reverse edge does not exist:
 * NotificationsModule never imports EventsModule; the dispatch PROCESSOR,
 * which needs EventsService to emit after persisting, lives in the
 * downstream NotificationDispatchModule. That split keeps this graph acyclic.
 */
@Module({
  imports: [SessionModule, NotificationsModule],
  providers: [EventsGateway, EventsService, SessionRevocationService],
  exports: [EventsService, SessionRevocationService],
})
export class EventsModule {}

import { Injectable } from '@nestjs/common';
import { SessionService } from '../auth/services/session.service';
import { EventsService } from './events.service';

/**
 * Revokes every server-side trace of a user's authentication in one step:
 * all Redis sessions AND all live websockets. Revoking sessions alone leaves
 * already-connected sockets authenticated until they happen to reconnect, so
 * the two must always travel together (logout-all, password change/reset,
 * role change).
 *
 * Lives in EventsModule rather than on SessionService because EventsModule
 * imports SessionModule (the gateway authenticates sockets via sessions), so
 * SessionService depending on EventsService would be a module cycle.
 */
@Injectable()
export class SessionRevocationService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly eventsService: EventsService,
  ) {}

  async revokeAllAndDisconnect(userId: string): Promise<void> {
    await this.sessionService.deleteAllUserSessions(userId);
    this.eventsService.disconnectUser(userId);
  }
}

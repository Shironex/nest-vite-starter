import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import {
  SocketEvents,
  type NotificationPayload,
  type ServerToClientEvents,
  type ClientToServerEvents,
} from '@repo/shared/events';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private server: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

  /**
   * Called by EventsGateway.afterInit() to provide the Socket.io server reference.
   */
  setServer(server: Server<ClientToServerEvents, ServerToClientEvents>): void {
    this.server = server;
    this.logger.log('Socket.io server reference set');
  }

  /**
   * Emit a notification to a specific user via their `user:{userId}` room.
   * Delivery only, never storage: the notification-dispatch worker persists
   * the Notification row FIRST and calls this after, so the socket event is a
   * live signal on top of the DB-backed bell, not the source of truth.
   */
  notifyUser(userId: string, payload: NotificationPayload): void {
    if (!this.server) {
      this.logger.warn('Cannot emit: server not initialized');
      return;
    }
    this.server.to(`user:${userId}`).emit(SocketEvents.NOTIFICATION, payload);
    this.logger.debug('Notification sent', { userId, title: payload.title });
  }

  /**
   * Forcibly disconnect every live socket belonging to a user. Call alongside
   * session revocation (deleteAllUserSessions): revoking the Redis sessions
   * alone leaves already-connected sockets authenticated until they happen to
   * reconnect. `disconnectSockets(true)` closes the underlying connections;
   * with the Redis adapter the room targeting fans out across replicas, so
   * sockets on other instances are disconnected too.
   */
  disconnectUser(userId: string): void {
    if (!this.server) {
      this.logger.warn('Cannot disconnect sockets: server not initialized');
      return;
    }
    this.server.in(`user:${userId}`).disconnectSockets(true);
    this.logger.debug('Disconnected sockets', { userId });
  }

  /**
   * Forcibly disconnect the sockets of ONE session, via the
   * `session:{sessionId}` room the gateway joins at handshake.
   *
   * The narrow twin of `disconnectUser`, and the reason the wide one stopped
   * being the only tool: logout, a single-device revoke and a max-sessions
   * eviction all end exactly one session, and dropping every socket the user
   * has was only ever a stand-in for a per-session room that did not exist.
   * `sessionId` is the Redis key id (the hashed cookie token), never the token
   * itself, so the room name carries nothing redeemable.
   */
  disconnectSession(sessionId: string): void {
    if (!this.server) {
      this.logger.warn('Cannot disconnect session sockets: server not initialized');
      return;
    }
    this.server.in(`session:${sessionId}`).disconnectSockets(true);
    // No id on the line: `sessionId` is on the logger's denylist, so the
    // runtime redactor would replace it and the lint rule refuses it up front.
    this.logger.debug('Disconnected session sockets');
  }
}

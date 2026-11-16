import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket, type DefaultEventsMap } from 'socket.io';
import {
  SocketEvents,
  type ServerToClientEvents,
  type ClientToServerEvents,
} from '@repo/shared/events';
import { CustomLogger } from '../logger/logger.service';
import { requestContext } from '../../common/context/request-context';
import { nowMs } from '../../common/clock';
import { detach } from '../../common/utils/detach';
import { getSessionCookieName } from '../auth/auth.constants';
import { SessionService } from '../auth/services/session.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from './events.service';

/**
 * Authenticated user data attached to socket after handshake validation.
 */
interface ISocketUser {
  id: string;
  email: string;
  role: string;
}

/**
 * Per-socket data the handshake stamps once the session validates.
 *
 * `sessionId` is the Redis key id (the hashed cookie token), which is also the
 * name of the room the socket joins, so one session can be dropped without
 * touching the user's other devices. `expiresAt` is that session's own expiry,
 * which the connection timer below closes the socket at.
 *
 * Both are optional because a socket refused during the handshake never
 * reaches the point where they are written, and the connection handlers must
 * read an unstamped socket rather than dereference through it.
 */
interface ISocketData {
  sessionId?: string;
  expiresAt?: number;
}

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, ISocketData>;

/**
 * Socket with authenticated user data attached.
 */
interface IAuthenticatedSocket extends Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  ISocketData
> {
  user: ISocketUser;
}

/**
 * `setTimeout` stores its delay in a signed 32-bit int, so anything past this
 * overflows and fires IMMEDIATELY (Node warns and clamps the delay to 1 ms). A
 * remember-me session lives 30 days, which is comfortably past it, so an
 * unclamped expiry timer would disconnect every remember-me socket the instant
 * it connected. `scheduleExpiry` re-arms instead of trusting one long timer.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Parse cookies from a raw Cookie header string.
 * Simple parser: no external dependency needed.
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(';')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
  }
  return cookies;
}

// CORS is configured by RedisIoAdapter (via ConfigService) at server-creation
// time, not here: @WebSocketGateway decorator metadata is evaluated before the
// DI container exists, so it cannot read the validated config.
@WebSocketGateway()
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: AppServer;

  /**
   * Live expiry timers, keyed by socket id. A gateway lives as long as the
   * process, so a timer that outlives its socket is a leak with teeth: it
   * keeps a closed socket (and its session id) reachable for up to 30 days.
   * `handleDisconnect` clears the entry, which is the only reason this map
   * exists rather than a closure nobody holds.
   */
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  /** Resolved once: '__Host-session_id' in production, 'session_id' otherwise. */
  private readonly sessionCookieName: string;

  constructor(
    private readonly sessionService: SessionService,
    private readonly eventsService: EventsService,
    private readonly notificationsService: NotificationsService,
    @Inject(CustomLogger) private readonly logger: CustomLogger,
    private readonly configService: ConfigService,
  ) {
    this.sessionCookieName = getSessionCookieName(
      this.configService.get<string>('NODE_ENV') === 'production',
    );
  }

  /**
   * Socket handlers run outside the HTTP middleware chain, so the ALS request
   * context is empty there and every log line would carry requestId
   * "no-context" with no traceId or user attribution. Mirror the pattern
   * TracedWorkerHost uses to rebuild context per job: enter
   * `requestContext.run(...)` per handler with a socket-derived requestId and
   * the authenticated user id (undefined during the pre-auth handshake).
   */
  private runInSocketContext<T>(
    client: Pick<Socket, 'id'> & { user?: ISocketUser },
    fn: () => T,
  ): T {
    return requestContext.run({ requestId: `ws-${client.id}`, userId: client.user?.id }, fn);
  }

  /**
   * Register session-validation middleware on the Socket.io server after init.
   */
  afterInit(server: AppServer): void {
    this.eventsService.setServer(server);

    // Socket.io ignores a middleware's return value, so the async check is
    // detached: every failure inside it already ends in next(Error) via the
    // catch below, and detach() logs anything that escapes rather than letting
    // it reach the process-exiting unhandledRejection policy.
    server.use((socket, next) => {
      detach(
        this.runInSocketContext(socket, async () => {
          try {
            const cookieHeader = socket.handshake.headers.cookie;
            if (!cookieHeader) {
              return next(new Error('Authentication failed: no cookies'));
            }

            const cookies = parseCookies(cookieHeader);
            const sessionToken = cookies[this.sessionCookieName];

            if (!sessionToken) {
              return next(new Error('Authentication failed: no session cookie'));
            }

            const session = await this.sessionService.validateSession(sessionToken);
            if (!session) {
              return next(new Error('Authentication failed: invalid session'));
            }

            // Attach user data to socket for later use
            (socket as IAuthenticatedSocket).user = {
              id: session.userId,
              email: session.email,
              role: session.role,
            };
            // The session identity rides alongside it: `handleConnection` turns
            // the id into a room (so logout, a single-device revoke and an
            // eviction can each close exactly one session's sockets) and the
            // expiry into a timer (so a session that simply runs out closes
            // its sockets too, without anyone having to call anything).
            socket.data.sessionId = session.sessionId;
            socket.data.expiresAt = session.expiresAt;

            next();
          } catch (error) {
            this.logger.error(
              'WebSocket authentication error',
              error instanceof Error ? error.stack : String(error),
              EventsGateway.name,
            );
            next(new Error('Authentication failed'));
          }
        }),
        { task: 'websocket.authenticate', socketId: socket.id },
      );
    });

    this.logger.log('WebSocket gateway initialized with session authentication');
  }

  /**
   * Handle new client connection: join the user room and the session room, and
   * arm the session's expiry.
   *
   * Two rooms, not one. `user:<id>` is the fan-out target notifications emit
   * to; `session:<id>` exists purely so ONE session can be closed. Without it
   * the only server-side close was user-wide, which is why logging out one
   * device used to drop every device, and why logout and max-sessions eviction
   * dropped nothing at all.
   */
  handleConnection(client: IAuthenticatedSocket): void {
    this.runInSocketContext(client, () => {
      const user = client.user;
      if (user) {
        const sessionId = client.data.sessionId;
        const rooms =
          sessionId === undefined
            ? [`user:${user.id}`]
            : [`user:${user.id}`, `session:${sessionId}`];
        // join() is synchronous on the in-memory adapter and may return a
        // promise on others; either way nothing here waits on it.
        detach(Promise.resolve(client.join(rooms)), {
          task: 'websocket.joinUserRoom',
          socketId: client.id,
        });
        this.scheduleExpiry(client);
        // Log the user id, never the email: log message strings are not redacted.
        this.logger.log(`Client connected: ${client.id} (user: ${user.id})`);
      } else {
        this.logger.warn('Client connected without user data', { clientId: client.id });
      }
    });
  }

  /**
   * Handle client disconnection.
   */
  handleDisconnect(client: IAuthenticatedSocket): void {
    this.clearExpiry(client.id);
    this.runInSocketContext(client, () => {
      const user = client.user;
      this.logger.log(`Client disconnected: ${client.id}${user ? ` (user: ${user.id})` : ''}`);
    });
  }

  /**
   * Close the socket when its session's own `expiresAt` arrives.
   *
   * The session blob carries a fixed expiry and the Redis key's TTL enforces it
   * for HTTP, but nothing re-reads the session on an open socket: without this
   * a connection outlives its session until it happens to reconnect. The client
   * closes its own socket when it notices it is logged out, so the gap is
   * exactly where the client does not cooperate (another tab, a copied cookie,
   * a connection nobody is watching).
   *
   * Re-arms rather than scheduling one long timer, because a remember-me
   * session is 30 days and `setTimeout` overflows past ~24.8 days (see
   * {@link MAX_TIMEOUT_MS}). Already-expired reads close the socket at once:
   * `validateSession` refuses an expired blob, so reaching here with one means
   * the session ran out between the handshake and the connection.
   */
  private scheduleExpiry(client: IAuthenticatedSocket): void {
    const expiresAt = client.data.expiresAt;
    if (expiresAt === undefined) {
      return;
    }

    const remaining = expiresAt - nowMs();
    if (remaining <= 0) {
      this.clearExpiry(client.id);
      client.disconnect(true);
      return;
    }

    const timer = setTimeout(
      () => {
        this.scheduleExpiry(client);
      },
      Math.min(remaining, MAX_TIMEOUT_MS),
    );
    // A pending expiry must never be the reason the process cannot exit: the
    // socket itself already holds the event loop open while it is connected.
    timer.unref();
    this.expiryTimers.set(client.id, timer);
  }

  /** Drop a socket's expiry timer, if it has one. Safe to call twice. */
  private clearExpiry(socketId: string): void {
    const timer = this.expiryTimers.get(socketId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.expiryTimers.delete(socketId);
    }
  }

  /**
   * Test notification handler (development only). Client sends
   * test:notification and receives a notification back via their room.
   * Delegates to NotificationsService.sendTestNotification so the dev smoke
   * test rides the FULL production pipeline (enqueue -> persist -> emit)
   * instead of a bespoke emit-only shortcut. Only the enqueue is awaited; a
   * failed enqueue (Redis down) acks { ok: false }.
   */
  @SubscribeMessage(SocketEvents.TEST_NOTIFICATION)
  async handleTestNotification(client: IAuthenticatedSocket): Promise<{ ok: boolean }> {
    return this.runInSocketContext(client, async () => {
      if (this.configService.get<string>('NODE_ENV') === 'production') {
        this.logger.warn('Test notification attempted in production; ignoring');
        return { ok: false };
      }

      const user = client.user;
      if (!user) {
        return { ok: false };
      }

      try {
        await this.notificationsService.sendTestNotification(user);
      } catch (error) {
        this.logger.error(
          'Test notification enqueue failed',
          error instanceof Error ? error.stack : String(error),
          EventsGateway.name,
        );
        return { ok: false };
      }
      this.logger.debug('Test notification enqueued', { userId: user.id });
      return { ok: true };
    });
  }
}

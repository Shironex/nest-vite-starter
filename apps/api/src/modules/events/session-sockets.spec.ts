/**
 * The per-session socket room, end to end, on a Socket.io server that actually
 * models rooms.
 *
 * The invariant: a socket outlives neither its session nor its session's
 * ending. Logout, a single-device revoke and a max-sessions eviction each close
 * exactly the sockets of the session they end, and none of the user's others.
 * That matters because notifications are tenant data (workspace names, a
 * colleague's address and their new role), and the gateway checks the
 * session once, at handshake, and never again.
 *
 * The collaborators here are REAL where the claim lives: the gateway, the
 * events service, the session service (on ioredis-mock, so no lane shares the
 * dev Redis), the logout path, the mint path and the revoke path. The fake is
 * the Socket.io server, and it is a fake that keeps rooms, delivery and
 * connectedness honestly: a `jest.fn()` server can only show that a
 * disconnect was ASKED for, which is the weaker claim.
 */
import type { Request, Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import type { NotificationPayload } from '@repo/shared/events';
import { SocketEvents } from '@repo/shared/events';
import type { CustomLogger } from '../logger/logger.service';
import type { CsrfService } from '../../common/security/csrf.service';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { TwoFactorEnrollmentReader } from '../auth/services/two-factor-enrollment.reader';
import { AuthSharedService } from '../auth/services/auth-shared.service';
import { LoginService } from '../auth/services/login.service';
import { SessionManagementService } from '../auth/services/session-management.service';
import { SessionService } from '../auth/services/session.service';
import { EventsGateway } from './events.gateway';
import { EventsService } from './events.service';
import { SessionRevocationService } from './session-revocation.service';

interface IDelivered {
  event: string;
  payload: NotificationPayload;
}

interface IFakeSocket {
  id: string;
  handshake: { headers: { cookie?: string } };
  data: { sessionId?: string; expiresAt?: number };
  user?: { id: string; email: string; role: string };
  rooms: Set<string>;
  connected: boolean;
  delivered: IDelivered[];
  join(rooms: string | string[]): void;
  disconnect(close: boolean): void;
}

type Middleware = (socket: unknown, next: (err?: Error) => void) => void;

const notification: NotificationPayload = {
  id: 'n-1',
  type: 'info',
  title: 'New workspace',
  message: 'Workspace A',
  timestamp: 1,
};

const silentLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
} as unknown as CustomLogger;

/**
 * A Socket.io server that keeps rooms: `to(room).emit` reaches exactly the
 * connected sockets in that room, and `in(room).disconnectSockets(true)` closes
 * exactly those. Everything the claim is about is observable on it.
 */
const buildRoomServer = () => {
  const sockets: IFakeSocket[] = [];
  let middleware: Middleware | undefined;
  let nextSocketId = 0;

  const membersOf = (room: string): IFakeSocket[] =>
    sockets.filter((socket) => socket.connected && socket.rooms.has(room));

  const server = {
    use: (fn: Middleware) => {
      middleware = fn;
    },
    to: (room: string) => ({
      emit: (event: string, payload: NotificationPayload) => {
        for (const socket of membersOf(room)) {
          socket.delivered.push({ event, payload });
        }
      },
    }),
    in: (room: string) => ({
      disconnectSockets: (close: boolean) => {
        for (const socket of membersOf(room)) {
          socket.disconnect(close);
        }
      },
    }),
  };

  return {
    server: server as never,
    /**
     * Open a socket carrying `token` as its session cookie, exactly as a
     * browser would: through the gateway's handshake middleware, then through
     * `handleConnection`. Resolves to the socket, or null when the handshake
     * refused it.
     */
    connect: async (gateway: EventsGateway, token: string): Promise<IFakeSocket | null> => {
      if (!middleware) {
        throw new Error('gateway.afterInit was never called');
      }
      nextSocketId += 1;
      const socket: IFakeSocket = {
        id: `sock-${nextSocketId}`,
        handshake: { headers: { cookie: `session_id=${token}` } },
        data: {},
        rooms: new Set<string>(),
        connected: true,
        delivered: [],
        join(rooms) {
          for (const room of Array.isArray(rooms) ? rooms : [rooms]) {
            this.rooms.add(room);
          }
        },
        disconnect() {
          if (!this.connected) {
            return;
          }
          this.connected = false;
          gateway.handleDisconnect(
            this as unknown as Parameters<EventsGateway['handleDisconnect']>[0],
          );
        },
      };

      let refusal: Error | undefined;
      middleware(socket, (err?: Error) => {
        refusal = err;
      });
      // The middleware detaches its async check (Socket.io ignores the return
      // value), so settle one macrotask before reading the outcome.
      await new Promise((resolve) => setImmediate(resolve));
      if (refusal) {
        return null;
      }

      sockets.push(socket);
      gateway.handleConnection(
        socket as unknown as Parameters<EventsGateway['handleConnection']>[0],
      );
      return socket;
    },
  };
};

const buildSubject = () => {
  const redis = new RedisMock() as unknown as Redis;
  const sessionService = new SessionService(redis);
  const eventsService = new EventsService();
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const csrf = { rotate: jest.fn() } as unknown as CsrfService;
  const config = {
    get: jest.fn((key: string) => (key === 'NODE_ENV' ? 'development' : undefined)),
    getOrThrow: jest.fn(() => 'http://localhost:3000'),
  } as unknown as ConfigService;

  const gateway = new EventsGateway(
    sessionService,
    eventsService,
    {} as NotificationsService,
    silentLogger,
    config,
    // No session under test carries the enrollment flag, so the reader is never
    // consulted; it answers "no" if it ever is.
    {
      isEnrollmentStillRequired: jest.fn().mockResolvedValue(false),
    } as unknown as TwoFactorEnrollmentReader,
  );

  const shared = new AuthSharedService(
    config,
    {} as never,
    sessionService,
    csrf,
    eventsService,
    redis,
  );

  const login = new LoginService(
    {} as never,
    sessionService,
    {} as never,
    {} as never,
    new SessionRevocationService(sessionService, eventsService),
    eventsService,
    csrf,
    audit,
    shared,
    {} as never,
  );

  const sessions = new SessionManagementService(
    sessionService,
    new SessionRevocationService(sessionService, eventsService),
    eventsService,
    audit,
    shared,
  );

  const rooms = buildRoomServer();
  gateway.afterInit(rooms.server);

  return { gateway, eventsService, sessionService, shared, login, sessions, rooms };
};

/** A session for `userId`, minted through the ordinary mint path. */
const mint = async (shared: AuthSharedService, userId: string): Promise<{ token: string }> => {
  const res = { cookie: jest.fn() } as unknown as Response;
  const session = await shared.establishSession({ headers: {} } as Request, res, {
    userId,
    email: `${userId}@organization.test`,
    role: 'USER',
    emailVerified: true,
    ip: '203.0.113.7',
    userAgent: 'jest',
    rememberMe: false,
  });
  return { token: session.token };
};

const expectStillReceiving = (
  socket: IFakeSocket,
  eventsService: EventsService,
  userId: string,
) => {
  const before = socket.delivered.length;
  eventsService.notifyUser(userId, notification);
  expect(socket.connected).toBe(true);
  expect(socket.delivered.slice(before)).toEqual([
    { event: SocketEvents.NOTIFICATION, payload: notification },
  ]);
};

describe('per-session socket rooms', () => {
  it('control: a connected socket receives its user fan-out', async () => {
    const { gateway, eventsService, shared, rooms } = buildSubject();
    const { token } = await mint(shared, 'u-1');

    const socket = await rooms.connect(gateway, token);
    if (!socket) throw new Error('handshake refused a valid session');

    expectStillReceiving(socket, eventsService, 'u-1');
  });

  it('logout closes that session socket and leaves the user other device connected', async () => {
    const { gateway, eventsService, shared, login, rooms } = buildSubject();
    const a = await mint(shared, 'u-1');
    const b = await mint(shared, 'u-1');

    const socketA = await rooms.connect(gateway, a.token);
    const socketB = await rooms.connect(gateway, b.token);
    if (!socketA || !socketB) throw new Error('handshake refused a valid session');

    const res = { cookie: jest.fn() } as unknown as Response;
    await login.logout(a.token, { headers: {} } as Request, res);

    expect(socketA.connected).toBe(false);
    // Delivery, not just connectedness: a closed socket that is still in the
    // room would keep receiving tenant notifications, which is the whole bug.
    eventsService.notifyUser('u-1', notification);
    expect(socketA.delivered).toEqual([]);
    expect(socketB.delivered).toEqual([
      { event: SocketEvents.NOTIFICATION, payload: notification },
    ]);
  });

  it('revoking one session does not disconnect the user other devices', async () => {
    const { gateway, eventsService, sessionService, shared, sessions, rooms } = buildSubject();
    const a = await mint(shared, 'u-1');
    const b = await mint(shared, 'u-1');

    const socketA = await rooms.connect(gateway, a.token);
    const socketB = await rooms.connect(gateway, b.token);
    if (!socketA || !socketB) throw new Error('handshake refused a valid session');

    const validatedA = await sessionService.validateSession(a.token);
    if (!validatedA) throw new Error('expected session A to validate');
    const [listedA] = (await sessions.listSessions('u-1', validatedA.sessionId)).filter(
      (row) => row.isCurrent,
    );
    if (!listedA) throw new Error('expected session A in the list');

    await sessions.revokeSession('u-1', listedA.id, { ip: '203.0.113.7', userAgent: 'jest' });

    expect(socketA.connected).toBe(false);
    expectStillReceiving(socketB, eventsService, 'u-1');
  });

  it('a fourth login evicts the oldest session and closes that session socket', async () => {
    const { gateway, eventsService, shared, rooms } = buildSubject();
    const first = await mint(shared, 'u-1');

    const oldest = await rooms.connect(gateway, first.token);
    if (!oldest) throw new Error('handshake refused a valid session');

    const second = await mint(shared, 'u-1');
    const third = await mint(shared, 'u-1');
    const survivorTokens = [second.token, third.token];
    const survivors = [];
    for (const token of survivorTokens) {
      const socket = await rooms.connect(gateway, token);
      if (!socket) throw new Error('handshake refused a valid session');
      survivors.push(socket);
    }

    // MAX_SESSIONS is 3, so this mint evicts the oldest blob. The eviction has
    // to close that session's socket: the blob is gone, nothing re-checks a
    // connected socket, and the room membership alone would keep it receiving.

    await mint(shared, 'u-1');

    expect(oldest.connected).toBe(false);
    eventsService.notifyUser('u-1', notification);
    expect(oldest.delivered).toEqual([]);
    for (const survivor of survivors) {
      expect(survivor.connected).toBe(true);
    }
  });

  it('an evicted session cannot open a new socket either', async () => {
    const { gateway, shared, rooms } = buildSubject();
    const first = await mint(shared, 'u-1');
    await mint(shared, 'u-1');
    await mint(shared, 'u-1');
    await mint(shared, 'u-1');

    expect(await rooms.connect(gateway, first.token)).toBeNull();
  });
});

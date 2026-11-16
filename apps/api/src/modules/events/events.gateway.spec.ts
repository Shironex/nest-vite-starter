import { EventsGateway } from './events.gateway';
import { getRequestContext, type IRequestContext } from '../../common/context/request-context';

type Middleware = (socket: unknown, next: (err?: Error) => void) => Promise<void> | void;

const buildGateway = (nodeEnv = 'development') => {
  const sessionService = { validateSession: jest.fn() };
  const eventsService = {
    setServer: jest.fn(),
  };
  const notificationsService = {
    sendTestNotification: jest.fn().mockResolvedValue(undefined),
  };
  const logger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined)),
  };
  const gateway = new EventsGateway(
    sessionService as unknown as ConstructorParameters<typeof EventsGateway>[0],
    eventsService as unknown as ConstructorParameters<typeof EventsGateway>[1],
    notificationsService as unknown as ConstructorParameters<typeof EventsGateway>[2],
    logger as unknown as ConstructorParameters<typeof EventsGateway>[3],
    configService as unknown as ConstructorParameters<typeof EventsGateway>[4],
  );
  return {
    gateway,
    sessionService,
    eventsService,
    notificationsService,
    configService,
  };
};

const buildServerCapture = () => {
  let captured: Middleware | null = null;
  const server = {
    use: jest.fn((fn: Middleware) => {
      captured = fn;
    }),
  };
  return {
    server: server as never,
    use: server.use,
    getMiddleware: () => {
      if (!captured) throw new Error('middleware not registered');
      return captured;
    },
  };
};

interface IFakeSocketUser {
  id: string;
  email: string;
  role: string;
}

/**
 * A connected socket as the gateway sees it after a successful handshake: the
 * user the middleware attached, and the `data` bag it stamped the session id
 * and expiry onto. `join` and `disconnect` are the two calls the connection
 * handlers make on it.
 */
const buildClient = (
  overrides: {
    id?: string;
    user?: IFakeSocketUser | undefined;
    sessionId?: string;
    expiresAt?: number;
  } = {},
) => {
  const join = jest.fn();
  const disconnect = jest.fn();
  const data: { sessionId?: string; expiresAt?: number } = {};
  if (overrides.sessionId !== undefined) data.sessionId = overrides.sessionId;
  if (overrides.expiresAt !== undefined) data.expiresAt = overrides.expiresAt;
  const client = {
    id: overrides.id ?? 'sock-1',
    join,
    disconnect,
    data,
    user: 'user' in overrides ? overrides.user : { id: 'u-1', email: 'e', role: 'USER' },
  };
  return { client, join, disconnect, data };
};

type FakeClient = ReturnType<typeof buildClient>['client'];

const asConnectArg = (client: FakeClient): Parameters<EventsGateway['handleConnection']>[0] =>
  client as unknown as Parameters<EventsGateway['handleConnection']>[0];

const asDisconnectArg = (client: FakeClient): Parameters<EventsGateway['handleDisconnect']>[0] =>
  client as unknown as Parameters<EventsGateway['handleDisconnect']>[0];

describe('EventsGateway', () => {
  describe('afterInit', () => {
    it('passes the server reference to EventsService.setServer', () => {
      const { gateway, eventsService } = buildGateway();
      const { server } = buildServerCapture();
      gateway.afterInit(server);
      expect(eventsService.setServer).toHaveBeenCalledWith(server);
    });

    it('registers a session-validation middleware via server.use', () => {
      const { gateway } = buildGateway();
      const { server, use } = buildServerCapture();
      gateway.afterInit(server);
      // Exactly one middleware; what it admits and refuses is pinned by the
      // session-validation cases below.
      expect(use).toHaveBeenCalledTimes(1);
      expect(use).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('session-validation middleware', () => {
    const runMiddleware = (
      cookieHeader: string | undefined,
      validateImpl: jest.Mock,
      nodeEnv = 'development',
    ) => {
      const { gateway } = buildGateway(nodeEnv);
      // Override sessionService.validateSession via the closure captured at construction.
      (gateway as unknown as { sessionService: { validateSession: jest.Mock } }).sessionService = {
        validateSession: validateImpl,
      };

      const { server, getMiddleware } = buildServerCapture();
      gateway.afterInit(server);
      const mw = getMiddleware();
      const next = jest.fn();
      const socket: Record<string, unknown> = {
        id: 'sock-mw',
        handshake: { headers: cookieHeader === undefined ? {} : { cookie: cookieHeader } },
        // Socket.io gives every socket a `data` bag; the handshake stamps the
        // session id and expiry onto it.
        data: {},
      };
      // The middleware detaches its async check (Socket.io ignores the return
      // value), so settle one macrotask: every awaited mock has resolved by then.
      const run = async (): Promise<void> => {
        mw(socket, next);
        await new Promise((resolve) => setImmediate(resolve));
      };
      return { run, next, socket };
    };

    it('next(Error) when no cookie header present', async () => {
      const { run, next } = runMiddleware(undefined, jest.fn());
      await run();
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect((next.mock.calls[0]?.[0] as Error).message).toBe('Authentication failed: no cookies');
    });

    it('next(Error) when cookie header lacks session_id', async () => {
      const { run, next } = runMiddleware('foo=bar; baz=qux', jest.fn());
      await run();
      expect((next.mock.calls[0]?.[0] as Error).message).toBe(
        'Authentication failed: no session cookie',
      );
    });

    it('next(Error) when validateSession returns null', async () => {
      const validate = jest.fn().mockResolvedValue(null);
      const { run, next } = runMiddleware('session_id=tok', validate);
      await run();
      expect(validate).toHaveBeenCalledWith('tok');
      expect((next.mock.calls[0]?.[0] as Error).message).toBe(
        'Authentication failed: invalid session',
      );
    });

    it('attaches user and calls next() with no args on valid session', async () => {
      const validate = jest.fn().mockResolvedValue({
        userId: 'u-1',
        email: 'e@x.c',
        role: 'USER',
      });
      const { run, next, socket } = runMiddleware('session_id=tok', validate);
      await run();
      expect(next).toHaveBeenCalledWith();
      expect((socket as { user: unknown }).user).toEqual({
        id: 'u-1',
        email: 'e@x.c',
        role: 'USER',
      });
    });

    it('stamps the session id and expiry on socket.data (the per-session room and timer)', async () => {
      const expiresAt = Date.now() + 3_600_000;
      const validate = jest.fn().mockResolvedValue({
        userId: 'u-1',
        email: 'e@x.c',
        role: 'USER',
        sessionId: 'sid-1',
        expiresAt,
      });
      const { run, socket } = runMiddleware('session_id=tok', validate);
      await run();
      // The hashed session id, never the cookie token: the room name is derived
      // from it, and a room name is not a secret.
      expect((socket as { data: unknown }).data).toEqual({ sessionId: 'sid-1', expiresAt });
      expect((socket as { data: Record<string, unknown> }).data['sessionId']).not.toBe('tok');
    });

    it('stamps nothing on a refused handshake', async () => {
      const validate = jest.fn().mockResolvedValue(null);
      const { run, socket } = runMiddleware('session_id=tok', validate);
      await run();
      expect((socket as { data: unknown }).data).toEqual({});
    });

    it('admits a valid session', async () => {
      const validate = jest.fn().mockResolvedValue({ userId: 'u-1', email: 'e@x.c', role: 'USER' });
      const { run, next } = runMiddleware('session_id=tok', validate);
      await run();
      expect(next).toHaveBeenCalledWith();
    });

    it('next(Error) and logs when validateSession throws', async () => {
      const validate = jest.fn().mockRejectedValue(new Error('redis down'));
      const { run, next } = runMiddleware('session_id=tok', validate);
      await run();
      expect((next.mock.calls[0]?.[0] as Error).message).toBe('Authentication failed');
    });

    it('parseCookies handles URL-encoded values and trims whitespace', async () => {
      const validate = jest.fn().mockResolvedValue({ userId: 'u', email: 'e', role: 'USER' });
      const { run, next } = runMiddleware('  session_id=ab%20cd  ', validate);
      await run();
      expect(validate).toHaveBeenCalledWith('ab cd');
      expect(next).toHaveBeenCalledWith();
    });

    it('parseCookies skips malformed pairs (no `=`)', async () => {
      const validate = jest.fn().mockResolvedValue({ userId: 'u', email: 'e', role: 'USER' });
      const { run, next } = runMiddleware('badpair; session_id=tok', validate);
      await run();
      expect(validate).toHaveBeenCalledWith('tok');
      expect(next).toHaveBeenCalledWith();
    });

    it('parseCookies skips pairs with empty key (=value with no name)', async () => {
      const validate = jest.fn().mockResolvedValue({ userId: 'u', email: 'e', role: 'USER' });
      // Leading `=oops` should be dropped (key === ''); trailing pair is consumed.
      const { run, next } = runMiddleware('=oops; session_id=tok', validate);
      await run();
      expect(validate).toHaveBeenCalledWith('tok');
      expect(next).toHaveBeenCalledWith();
    });

    it('production reads the __Host- prefixed cookie name', async () => {
      const validate = jest.fn().mockResolvedValue({ userId: 'u-1', email: 'e', role: 'USER' });
      const { run, next } = runMiddleware('__Host-session_id=tok', validate, 'production');
      await run();
      expect(validate).toHaveBeenCalledWith('tok');
      expect(next).toHaveBeenCalledWith();
    });

    it('production ignores the bare dev cookie name', async () => {
      const validate = jest.fn();
      const { run, next } = runMiddleware('session_id=tok', validate, 'production');
      await run();
      expect(validate).not.toHaveBeenCalled();
      expect((next.mock.calls[0]?.[0] as Error).message).toBe(
        'Authentication failed: no session cookie',
      );
    });

    it('treats key-only pair (no value) as missing session cookie', async () => {
      // `session_id=` parses to '', which trips the !sessionToken guard.
      const validate = jest.fn();
      const { run, next } = runMiddleware('session_id=', validate);
      await run();
      expect(validate).not.toHaveBeenCalled();
      expect((next.mock.calls[0]?.[0] as Error).message).toBe(
        'Authentication failed: no session cookie',
      );
    });

    it('runs inside a socket-derived ALS context (requestId ws-<socket.id>, no user pre-auth)', async () => {
      let captured: IRequestContext | undefined;
      const validate = jest.fn().mockImplementation(() => {
        captured = getRequestContext();
        return Promise.resolve({ userId: 'u-1', email: 'e', role: 'USER' });
      });
      const { run } = runMiddleware('session_id=tok', validate);
      await run();
      expect(captured).toMatchObject({ requestId: 'ws-sock-mw' });
      expect(captured?.userId).toBeUndefined();
    });
  });

  describe('handleConnection', () => {
    it('joins user:<id> AND session:<id> when the handshake stamped a session', () => {
      const { gateway } = buildGateway();
      const { client, join } = buildClient({ sessionId: 'sid-1' });
      gateway.handleConnection(asConnectArg(client));
      // The session room is what makes a single-session disconnect possible at
      // all; before it, the only server-side close was user-wide.
      expect(join).toHaveBeenCalledWith(['user:u-1', 'session:sid-1']);
    });

    it('joins only the user room when nothing stamped a session id', () => {
      const { gateway } = buildGateway();
      const { client, join } = buildClient({});
      gateway.handleConnection(asConnectArg(client));
      expect(join).toHaveBeenCalledWith(['user:u-1']);
    });

    it('does not join when client.user is missing (logs warn)', () => {
      const { gateway } = buildGateway();
      const { client, join } = buildClient({ user: undefined });
      gateway.handleConnection(asConnectArg(client));
      expect(join).not.toHaveBeenCalled();
    });

    it('runs inside a socket-derived ALS context carrying the authenticated user id', () => {
      const { gateway } = buildGateway();
      let captured: IRequestContext | undefined;
      const { client, join } = buildClient({
        id: 'sock-42',
        user: { id: 'u-7', email: 'e', role: 'USER' },
      });
      join.mockImplementation(() => {
        captured = getRequestContext();
      });
      gateway.handleConnection(asConnectArg(client));
      expect(captured).toMatchObject({ requestId: 'ws-sock-42', userId: 'u-7' });
    });
  });

  describe('session expiry', () => {
    const START = new Date('2026-09-20T09:00:00Z').getTime();

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(START);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('disconnects the socket at the session expiresAt, and not a tick before', () => {
      const { gateway } = buildGateway();
      const { client, disconnect } = buildClient({
        sessionId: 'sid-1',
        expiresAt: START + 60_000,
      });

      gateway.handleConnection(asConnectArg(client));

      jest.advanceTimersByTime(59_999);
      expect(disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      // close: true drops the underlying connection, not just the namespace.
      expect(disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects immediately when the session ran out between handshake and connect', () => {
      const { gateway } = buildGateway();
      const { client, disconnect } = buildClient({ sessionId: 'sid-1', expiresAt: START - 1 });
      gateway.handleConnection(asConnectArg(client));
      expect(disconnect).toHaveBeenCalledWith(true);
    });

    it('does not fire early for a remember-me session past the setTimeout 32-bit ceiling', () => {
      const { gateway } = buildGateway();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      const { client, disconnect } = buildClient({
        sessionId: 'sid-1',
        expiresAt: START + thirtyDays,
      });

      gateway.handleConnection(asConnectArg(client));

      // An unclamped setTimeout overflows a signed 32-bit delay and fires on
      // the next tick, which would close every remember-me socket at once.
      jest.advanceTimersByTime(thirtyDays - 1);
      expect(disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(disconnect).toHaveBeenCalledWith(true);
    });

    it('clears the timer on disconnect, so a closed socket is never touched again', () => {
      const { gateway } = buildGateway();
      const { client, disconnect } = buildClient({
        sessionId: 'sid-1',
        expiresAt: START + 60_000,
      });

      gateway.handleConnection(asConnectArg(client));
      gateway.handleDisconnect(asDisconnectArg(client));

      jest.advanceTimersByTime(120_000);
      expect(disconnect).not.toHaveBeenCalled();
      // A gateway lives as long as the process: a timer left armed here keeps a
      // closed socket and its session id reachable for up to 30 days.
      expect(jest.getTimerCount()).toBe(0);
    });

    it('arms no timer when the handshake stamped no expiry', () => {
      const { gateway } = buildGateway();
      const { client, disconnect } = buildClient({ sessionId: 'sid-1' });
      gateway.handleConnection(asConnectArg(client));
      expect(jest.getTimerCount()).toBe(0);
      jest.advanceTimersByTime(60 * 60 * 1000);
      expect(disconnect).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('does not throw with or without user attached', () => {
      const { gateway } = buildGateway();
      expect(() =>
        gateway.handleDisconnect({ id: 's', user: undefined } as unknown as Parameters<
          EventsGateway['handleDisconnect']
        >[0]),
      ).not.toThrow();
      expect(() =>
        gateway.handleDisconnect({
          id: 's',
          user: { id: 'u', email: 'e@x.c', role: 'USER' },
        } as unknown as Parameters<EventsGateway['handleDisconnect']>[0]),
      ).not.toThrow();
    });
  });

  describe('handleTestNotification', () => {
    it('returns { ok: false } in production without enqueueing', async () => {
      const { gateway, notificationsService } = buildGateway('production');
      const result = await gateway.handleTestNotification({
        id: 's',
        user: { id: 'u', email: 'e@x.c', role: 'USER' },
      } as unknown as Parameters<EventsGateway['handleTestNotification']>[0]);
      expect(result).toEqual({ ok: false });
      expect(notificationsService.sendTestNotification).not.toHaveBeenCalled();
    });

    it('returns { ok: false } when client has no user', async () => {
      const { gateway, notificationsService } = buildGateway();
      const result = await gateway.handleTestNotification({
        id: 's',
        user: undefined,
      } as unknown as Parameters<EventsGateway['handleTestNotification']>[0]);
      expect(result).toEqual({ ok: false });
      expect(notificationsService.sendTestNotification).not.toHaveBeenCalled();
    });

    it('happy path: rides the full pipeline via NotificationsService.sendTestNotification and acks { ok: true }', async () => {
      const { gateway, notificationsService } = buildGateway();
      const user = { id: 'u-1', email: 'e@x.c', role: 'USER' };
      const result = await gateway.handleTestNotification({
        id: 's',
        user,
      } as unknown as Parameters<EventsGateway['handleTestNotification']>[0]);
      expect(notificationsService.sendTestNotification).toHaveBeenCalledWith(user);
      expect(result).toEqual({ ok: true });
    });

    it('acks { ok: false } when the enqueue fails (Redis down) instead of throwing', async () => {
      const { gateway, notificationsService } = buildGateway();
      notificationsService.sendTestNotification.mockRejectedValue(new Error('redis down'));
      const user = { id: 'u-1', email: 'e@x.c', role: 'USER' };
      const result = await gateway.handleTestNotification({
        id: 's',
        user,
      } as unknown as Parameters<EventsGateway['handleTestNotification']>[0]);
      expect(result).toEqual({ ok: false });
    });

    it('runs inside a socket-derived ALS context (requestId ws-<socket.id>, userId)', async () => {
      const { gateway, notificationsService } = buildGateway();
      let captured: IRequestContext | undefined;
      notificationsService.sendTestNotification.mockImplementation(() => {
        captured = getRequestContext();
        return Promise.resolve();
      });
      const user = { id: 'u-9', email: 'e@x.c', role: 'USER' };
      await gateway.handleTestNotification({ id: 's-77', user } as unknown as Parameters<
        EventsGateway['handleTestNotification']
      >[0]);
      expect(captured).toMatchObject({ requestId: 'ws-s-77', userId: 'u-9' });
    });
  });
});

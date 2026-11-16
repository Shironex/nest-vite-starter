import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';
import type Redis from 'ioredis';
import { Logger, type INestApplicationContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DESKTOP_APP_ORIGIN } from '@repo/shared/constants';

export interface ISocketCorsOptions {
  readonly origin: string[];
  readonly credentials: boolean;
}

/**
 * Socket.io CORS, resolved from ConfigService at server-creation time. Lives
 * here (not in the @WebSocketGateway decorator) because decorator metadata is
 * evaluated at class-definition time, before the DI container and the validated
 * ConfigService exist. Exported as a pure function so the origin policy is
 * unit-testable without booting socket.io.
 */
export function resolveSocketCorsOptions(configService: ConfigService): ISocketCorsOptions {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';
  if (!isProduction) {
    return { origin: ['http://localhost:5173', DESKTOP_APP_ORIGIN], credentials: true };
  }

  const corsOrigins = configService.get<string>('CORS_ORIGINS');
  const origin =
    corsOrigins !== undefined && corsOrigins.trim() !== ''
      ? corsOrigins.split(',').map((value) => value.trim())
      : [configService.get<string>('APP_URL') ?? 'http://localhost:5173', DESKTOP_APP_ORIGIN];

  return { origin, credentials: true };
}

/**
 * Handshake origin fence for `allowRequest`.
 *
 * The `cors` option alone is NOT a policy: the cors middleware never rejects a
 * request, it only omits the Access-Control-Allow-Origin header, and a
 * WebSocket upgrade is not subject to the same-origin policy in the first
 * place. `EventsGateway` then authenticates purely from the session cookie, so
 * a socket opened from a foreign page that carries the cookie was accepted.
 * Today only `SameSite=Lax` stands in the way, and the desktop variant is
 * `SameSite=None`, so any cookie relaxation or a same-site sibling host would
 * let a hostile page read the victim's event stream.
 *
 * A missing Origin is refused too: every client this server has is a browser or
 * the Electron renderer, and both always send one (Electron sends
 * DESKTOP_APP_ORIGIN, which is in the same allow list).
 *
 * Exported as a pure factory so the policy is unit-testable without booting
 * socket.io.
 */
export function createHandshakeOriginGuard(
  allowedOrigins: readonly string[],
): (
  req: { headers: { origin?: string | undefined } },
  callback: (error: string | null | undefined, allow: boolean) => void,
) => void {
  return (req, callback) => {
    const origin = req.headers.origin;
    callback(null, typeof origin === 'string' && allowedOrigins.includes(origin));
  };
}

/**
 * Socket.io adapter that uses Redis pub/sub to broadcast events across API
 * replicas. Without this, an event emitted on replica A never reaches a
 * client connected to replica B.
 *
 * Sticky sessions are still required at the proxy/load-balancer (Traefik
 * sticky cookies, nginx ip_hash, etc.) because the long-poll fallback transport
 * does not survive switching replicas mid-flight. WebSocket-only deployments
 * can skip stickiness.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor!: ReturnType<typeof createAdapter>;
  private readonly logger = new Logger(RedisIoAdapter.name);

  constructor(
    app: INestApplicationContext,
    private readonly pubClient: Redis,
    private readonly configService: ConfigService,
  ) {
    super(app);
  }

  /**
   * ioredis connects lazily, so by the time this runs a client may already be
   * connected: that rejection is benign. Any OTHER rejection means cross-replica
   * broadcast is silently broken (the exact failure this adapter exists to
   * prevent), so it must be logged, not swallowed.
   */
  private handleConnectError(role: 'pub' | 'sub'): (err: Error) => void {
    return (err: Error) => {
      if (/already (connect|connecting)/i.test(err.message)) {
        this.logger.debug('WS Redis client already connected', { role });
      } else {
        this.logger.error('WS Redis client connection failed', { role }, err);
      }
    };
  }

  async connectToRedis(): Promise<void> {
    // ioredis is already connected lazily; duplicate() returns a clone using
    // the same options. socket.io requires a separate connection for sub.
    const subClient = this.pubClient.duplicate();
    await Promise.all([
      this.pubClient.connect().catch(this.handleConnectError('pub')),
      subClient.connect().catch(this.handleConnectError('sub')),
    ]);
    this.adapterConstructor = createAdapter(this.pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const cors = resolveSocketCorsOptions(this.configService);
    const server = super.createIOServer(port, {
      ...options,
      cors,
      // The same allow list, but enforced: `cors` alone never refuses a
      // handshake. See createHandshakeOriginGuard.
      allowRequest: createHandshakeOriginGuard(cors.origin),
    }) as { adapter: (a: unknown) => unknown };
    server.adapter(this.adapterConstructor);
    return server;
  }
}

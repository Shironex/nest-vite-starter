# Recipe: websockets

**When you need it:** the server must push to the browser (live collaboration, instant
notifications, progress). Polling with TanStack Query covers most apps and costs less to operate.

## Shape of the change

- **Gateway.** Add `@nestjs/websockets` and a platform adapter, then a gateway in its own module.
  Prefer plain `ws` or Socket.IO behind a thin `RealtimeGateway`; keep business logic in services
  that the gateway calls, as with routers.
- **Authenticating the handshake.** Reuse the session, do not invent a second login. On connect,
  read the session cookie from the upgrade request, call `SessionService.validateSession`, and close
  the socket on failure. The cookie is `__Host-` prefixed in production, so connect to the same
  origin the SPA uses. Check the `Origin` header against `APP_URL` and `CORS_ORIGINS`, because
  browsers do not apply CORS to websockets and CSRF protection does not cover the upgrade.
- **Rooms.** Join each socket to a room named after the user id (`user:<id>`) and send only to
  rooms. Never let the client choose a room name.
- **Revocation.** Disconnect a user's sockets when their sessions are revoked: a session revoke,
  password change, role change or account disable must also close live sockets, or the revocation
  does not hold for connected clients. Hook the revocation paths in `SessionService`.
- **Scaling.** Several api replicas need a shared adapter (the Redis adapter, using the Valkey you
  already run), and a proxy that passes the `Upgrade` header. The web container's nginx config
  needs a location for the socket path.
- **Web.** One client in `apps/web/src/lib/`, connected after sign-in and closed on sign-out, that
  invalidates query keys on messages.

## Pitfalls

- Add the socket origin to `connect-src` in the web CSP.
- Per-message authorization: a connection being authenticated does not mean every message is
  allowed. Validate payloads with the same Zod schemas.
- Rate limit message rates per socket. The global throttler does not see them.
- Integration tests need two sockets for two users, to prove one cannot read the other's room.

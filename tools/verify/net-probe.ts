import { connect } from 'node:net';

/*
 * A plain TCP connect, used to tell "the check failed" from "the service it
 * needed was not there". The difference is the whole point of the `blocked`
 * status: a lane whose database went away mid-run reports nothing about the
 * code, and must not be read as a failure of it either.
 */
export async function tcpReachable(
  host: string,
  port: number,
  timeoutMs = 2_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const settle = (reachable: boolean): void => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

/** Host and port of a `postgresql://user:pass@host:port/db` URL. */
export function hostPortOf(url: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port);
    if (parsed.hostname === '' || !Number.isInteger(port) || port <= 0) {
      return null;
    }
    return { host: parsed.hostname, port };
  } catch {
    return null;
  }
}

/*
 * Postgres readiness, which a TCP connect cannot answer. A Docker-published
 * port is accepted by the proxy before the server behind it listens, and any
 * other process can hold 5432; both look identical to `tcpReachable`, and the
 * gate that trusted it then failed with a connection error that reads like a
 * broken migration rather than "the database was not there".
 *
 * The probe sends a protocol-3 StartupMessage and reads the first reply:
 * `R` (authentication request) means the server is accepting connections, and
 * so does an `E` ErrorResponse for anything except SQLSTATE 57P03
 * (cannot_connect_now, which is what a server still starting up answers):
 * a rejected user or an unknown database still proves a ready Postgres. Any
 * other first byte is some other server, and silence is a port with nothing
 * behind it yet.
 *
 * The user name is only there because the message requires one; the probe
 * never authenticates, so it needs no credentials and opens no session.
 */
const PROTOCOL_VERSION_3 = 196_608;
const CANNOT_CONNECT_NOW = '57P03';
const PROBE_USER = 'postgres';

export interface IPostgresProbe {
  readonly ready: boolean;
  /** ready | unreachable | no-answer | starting-up | not-postgres */
  readonly reason: string;
}

function startupMessage(user: string): Buffer {
  const parameters = Buffer.from(`user\0${user}\0\0`, 'utf8');
  const message = Buffer.alloc(8 + parameters.length);
  message.writeInt32BE(message.length, 0);
  message.writeInt32BE(PROTOCOL_VERSION_3, 4);
  parameters.copy(message, 8);
  return message;
}

/** SQLSTATE of an ErrorResponse body (its `C` field), or '' when absent. */
function errorSqlState(body: Buffer): string {
  let offset = 0;
  while (offset < body.length && body[offset] !== 0) {
    const fieldType = String.fromCharCode(body[offset] ?? 0);
    const end = body.indexOf(0, offset + 1);
    if (end === -1) {
      return '';
    }
    if (fieldType === 'C') {
      return body.toString('utf8', offset + 1, end);
    }
    offset = end + 1;
  }
  return '';
}

/** Reads a complete first message out of the buffer, or null while it is short. */
function readProbe(buffer: Buffer): IPostgresProbe | null {
  if (buffer.length < 5) {
    return null;
  }
  const tag = String.fromCharCode(buffer[0] ?? 0);
  if (tag === 'R') {
    return { ready: true, reason: 'ready' };
  }
  if (tag !== 'E') {
    return { ready: false, reason: 'not-postgres' };
  }
  const length = buffer.readInt32BE(1);
  if (buffer.length < length + 1) {
    return null;
  }
  const sqlState = errorSqlState(buffer.subarray(5, length + 1));
  return sqlState === CANNOT_CONNECT_NOW
    ? { ready: false, reason: 'starting-up' }
    : { ready: true, reason: 'ready' };
}

export async function postgresReady(
  host: string,
  port: number,
  timeoutMs = 2_000,
): Promise<IPostgresProbe> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let buffer = Buffer.alloc(0);
    const settle = (probe: IPostgresProbe): void => {
      socket.destroy();
      resolve(probe);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => socket.write(startupMessage(PROBE_USER)));
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const probe = readProbe(buffer);
      if (probe !== null) {
        settle(probe);
      }
    });
    socket.once('timeout', () => settle({ ready: false, reason: 'no-answer' }));
    socket.once('close', () => settle({ ready: false, reason: 'no-answer' }));
    socket.once('error', () => settle({ ready: false, reason: 'unreachable' }));
  });
}

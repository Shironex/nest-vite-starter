import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';

/** A throwaway directory removed when the enclosing suite finishes. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/*
 * A stand-in for a Postgres port, so the readiness probe can be tested against
 * every answer a real port gives: a server accepting connections, one that is
 * still starting up, a published port with nothing behind it yet, and some
 * other server entirely holding 5432.
 */
export type FakePostgresMode = 'ready' | 'rejects' | 'starting-up' | 'silent' | 'other-server';

export interface IFakeServer {
  readonly port: number;
  readonly close: () => void;
}

function authenticationOk(): Buffer {
  const message = Buffer.alloc(9);
  message.write('R', 0, 'ascii');
  message.writeInt32BE(8, 1);
  message.writeInt32BE(0, 5);
  return message;
}

/** An ErrorResponse carrying `sqlState` in its `C` field. */
function errorResponse(sqlState: string, text: string): Buffer {
  const body = Buffer.from(`SFATAL\0C${sqlState}\0M${text}\0\0`, 'utf8');
  const message = Buffer.alloc(5 + body.length);
  message.write('E', 0, 'ascii');
  message.writeInt32BE(4 + body.length, 1);
  body.copy(message, 5);
  return message;
}

function reply(mode: FakePostgresMode): Buffer | null {
  switch (mode) {
    case 'ready':
      return authenticationOk();
    case 'rejects':
      // A ready server that refuses this connection: no such database. Still a
      // Postgres answering, which is all the probe claims to establish.
      return errorResponse('3D000', 'database "saas_starter" does not exist');
    case 'starting-up':
      return errorResponse('57P03', 'the database system is starting up');
    case 'other-server':
      return Buffer.from('HTTP/1.1 400 Bad Request\r\n\r\n', 'utf8');
    case 'silent':
      return null;
  }
}

export async function fakePostgres(mode: FakePostgresMode): Promise<IFakeServer> {
  const server = createServer((socket) => {
    socket.on('data', () => {
      const answer = reply(mode);
      if (answer !== null) {
        socket.write(answer);
      }
    });
    socket.on('error', () => socket.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('could not open a fake Postgres port');
  }

  const close = (): void => {
    server.close();
  };
  after(close);
  return { port: address.port, close };
}

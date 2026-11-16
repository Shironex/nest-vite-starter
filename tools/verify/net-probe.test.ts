import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { describe, it } from 'node:test';

import { hostPortOf, postgresReady, tcpReachable } from './net-probe';
import { freePort } from './ports';
import { fakePostgres } from './test-support';

describe('service reachability', () => {
  it('sees a listening socket', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');

    try {
      assert.equal(await tcpReachable('127.0.0.1', address.port), true);
    } finally {
      server.close();
    }
  });

  it('reports a port nothing listens on as unreachable', async () => {
    assert.equal(await tcpReachable('127.0.0.1', await freePort()), false);
  });

  it('reads the host and port out of a lane URL', () => {
    assert.deepEqual(
      hostPortOf('postgresql://postgres:postgres@127.0.0.1:49200/saas_starter_isolation'),
      {
        host: '127.0.0.1',
        port: 49_200,
      },
    );
  });

  it('refuses a URL with no port rather than guessing 5432', () => {
    assert.equal(hostPortOf('postgresql://postgres:postgres@localhost/saas_starter_dev'), null);
    assert.equal(hostPortOf(''), null);
    assert.equal(hostPortOf('not a url'), null);
  });
});

describe('postgres readiness', () => {
  it('sees a server that answers the startup handshake', async () => {
    const server = await fakePostgres('ready');

    assert.deepEqual(await postgresReady('127.0.0.1', server.port), {
      ready: true,
      reason: 'ready',
    });
  });

  it('counts an error answer as ready: the server is up, it just refused this connection', async () => {
    const server = await fakePostgres('rejects');

    assert.equal((await postgresReady('127.0.0.1', server.port)).ready, true);
  });

  it('reports a server that is still starting up as not ready', async () => {
    const server = await fakePostgres('starting-up');

    assert.deepEqual(await postgresReady('127.0.0.1', server.port), {
      ready: false,
      reason: 'starting-up',
    });
  });

  it('reports an open port with nothing answering behind it as not ready', async () => {
    // The Docker case the old TCP probe passed: the published port accepts the
    // connection before the server in the container listens.
    const server = await fakePostgres('silent');

    assert.deepEqual(await postgresReady('127.0.0.1', server.port, 250), {
      ready: false,
      reason: 'no-answer',
    });
  });

  it('reports another server holding the port as not ready', async () => {
    const server = await fakePostgres('other-server');

    assert.deepEqual(await postgresReady('127.0.0.1', server.port, 250), {
      ready: false,
      reason: 'not-postgres',
    });
  });

  it('reports a port nothing listens on as unreachable', async () => {
    assert.deepEqual(await postgresReady('127.0.0.1', await freePort(), 250), {
      ready: false,
      reason: 'unreachable',
    });
  });
});

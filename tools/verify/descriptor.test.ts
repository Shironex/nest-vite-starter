import assert from 'node:assert/strict';
import { statSync, writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { ISandboxDescriptor } from './descriptor';
import {
  databaseUrl,
  descriptorPath,
  laneDatabaseUrl,
  laneRedisUrl,
  listDescriptors,
  parseDescriptor,
  readDescriptor,
  removeDescriptor,
  servicePort,
  smtpPort,
  withPorts,
  writeDescriptor,
} from './descriptor';
import { laneById } from './lanes';
import { tempDir } from './test-support';

function descriptor(overrides: Partial<ISandboxDescriptor> = {}): ISandboxDescriptor {
  return {
    schemaVersion: 1,
    id: 'abc12345',
    owner: 'owner-sha',
    root: '/tmp/worktree',
    createdAt: '2026-09-20T10:00:00.000Z',
    user: 'postgres',
    password: 'postgres',
    services: {
      postgres: {
        container: 'nest-vite-starter-sbx-abc12345-postgres',
        image: 'postgres:17-alpine',
        ports: { '5432': 49_200 },
      },
      redis: {
        container: 'nest-vite-starter-sbx-abc12345-redis',
        image: 'redis:7-alpine',
        ports: { '6379': 49_201 },
      },
      mailpit: {
        container: 'nest-vite-starter-sbx-abc12345-mailpit',
        image: 'mailpit',
        ports: { '1025': 49_203, '8025': 49_204 },
      },
    },
    ...overrides,
  };
}

describe('sandbox descriptor', () => {
  it('writes the descriptor readable by its owner alone', () => {
    const root = tempDir('verify-descriptor');
    const file = writeDescriptor(root, descriptor());

    assert.equal(file, descriptorPath(root, 'abc12345'));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readDescriptor(file), descriptor());
  });

  it('returns null rather than a partial descriptor for a malformed file', () => {
    const root = tempDir('verify-descriptor-bad');
    writeDescriptor(root, descriptor());
    const file = descriptorPath(root, 'abc12345');

    writeFileSync(file, '{ not json');
    assert.equal(readDescriptor(file), null);

    writeFileSync(file, JSON.stringify({ ...descriptor(), schemaVersion: 99 }));
    assert.equal(readDescriptor(file), null);

    writeFileSync(
      file,
      JSON.stringify({ ...descriptor(), services: { postgres: { container: 'x' } } }),
    );
    assert.equal(readDescriptor(file), null);

    assert.equal(parseDescriptor('null'), null);
  });

  it('returns null for a descriptor that was never written', () => {
    const root = tempDir('verify-descriptor-missing');

    assert.equal(readDescriptor(descriptorPath(root, 'nope')), null);
    assert.deepEqual(listDescriptors(root, 'owner-sha'), []);
  });

  it('lists only the descriptors this worktree owns, newest first', () => {
    const root = tempDir('verify-descriptor-list');
    writeDescriptor(root, descriptor({ id: 'old00001', createdAt: '2026-09-19T10:00:00.000Z' }));
    writeDescriptor(root, descriptor({ id: 'new00001', createdAt: '2026-09-20T10:00:00.000Z' }));
    writeDescriptor(root, descriptor({ id: 'other001', owner: 'someone-else' }));

    const mine = listDescriptors(root, 'owner-sha');

    assert.deepEqual(
      mine.map((entry) => entry.descriptor.id),
      ['new00001', 'old00001'],
    );

    removeDescriptor(mine[0]?.file ?? '');
    removeDescriptor(mine[0]?.file ?? '');
    assert.deepEqual(
      listDescriptors(root, 'owner-sha').map((entry) => entry.descriptor.id),
      ['old00001'],
    );
  });

  it('builds every lane URL on loopback, off the ports the descriptor recorded', () => {
    const subject = descriptor();

    assert.equal(
      laneDatabaseUrl(subject, laneById('isolation')),
      'postgresql://postgres:postgres@127.0.0.1:49200/nest_vite_starter_isolation',
    );
    assert.equal(laneRedisUrl(subject, laneById('e2e')), 'redis://127.0.0.1:49201/2');
    assert.equal(
      databaseUrl(subject, 'nest_vite_starter_template'),
      'postgresql://postgres:postgres@127.0.0.1:49200/nest_vite_starter_template',
    );
    assert.equal(smtpPort(subject), 49_203);
  });

  it('adopts the host ports docker reports now, because a restart moves them', () => {
    const moved = withPorts(descriptor(), (_container, port) => (port === '5432' ? 49_999 : null));

    assert.equal(servicePort(moved, 'postgres', '5432'), 49_999);
    // A lookup that could not answer (a stopped container) keeps the recorded
    // port, so the lane still has an address to fail its probe against.
    assert.equal(servicePort(moved, 'redis', '6379'), 49_201);
  });

  it('refuses to guess a port the sandbox never bound', () => {
    const subject = descriptor({ services: {} });

    assert.throws(() => servicePort(subject, 'postgres', '5432'), /sandbox:up/u);
  });
});

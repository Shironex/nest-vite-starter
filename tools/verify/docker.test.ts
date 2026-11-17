import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runArgs } from './docker';
import { containerName } from './sandbox-lifecycle';

describe('docker run arguments', () => {
  const args = runArgs({
    name: 'nest-vite-starter-sbx-abc12345-postgres',
    image: 'postgres:17-alpine',
    labels: {
      'nest-vite-starter.sandbox.owner': 'sha',
      'nest-vite-starter.sandbox.id': 'abc12345',
    },
    env: { POSTGRES_USER: 'postgres' },
    ports: ['5432'],
    extraArgs: ['--workdir', '/app'],
  });

  it('publishes every port on loopback with a kernel-chosen host port', () => {
    assert.ok(args.includes('-p'));
    assert.ok(args.includes('127.0.0.1::5432'));
    assert.ok(
      !args.some((arg) => /^\d+:\d+$/u.test(arg) || /^0\.0\.0\.0:/u.test(arg)),
      'a fixed or non-loopback host port would collide with the dev stack',
    );
  });

  it('labels the container with the owner and the sandbox id', () => {
    assert.ok(args.includes('nest-vite-starter.sandbox.owner=sha'));
    assert.ok(args.includes('nest-vite-starter.sandbox.id=abc12345'));
  });

  it('ends with the image, after the env and the extra arguments', () => {
    assert.equal(args.at(-1), 'postgres:17-alpine');
    assert.ok(args.indexOf('POSTGRES_USER=postgres') < args.length - 1);
    assert.ok(args.indexOf('--workdir') < args.indexOf('postgres:17-alpine'));
  });

  it('runs detached and never through compose', () => {
    assert.deepEqual(args.slice(0, 2), ['run', '-d']);
    assert.ok(!args.includes('compose'));
  });

  it('names containers so they cannot be confused with the dev stack', () => {
    const name = containerName('abc12345', 'postgres');

    assert.equal(name, 'nest-vite-starter-sbx-abc12345-postgres');
    assert.notEqual(name, 'nest-vite-starter-postgres');
  });
});

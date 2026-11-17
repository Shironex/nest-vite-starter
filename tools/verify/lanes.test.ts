import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { commandFor, LANES, parseSelection, UsageError } from './lanes';

const ids = (argv: string[]) => parseSelection(argv).lanes.map((lane) => lane.id);

describe('verify lanes', () => {
  it('declares the five lanes in gate order', () => {
    assert.deepEqual(
      LANES.map((lane) => lane.id),
      ['format', 'lint', 'typecheck', 'test', 'build'],
    );
  });

  it('runs lint:meta in the lint lane and the tools tests in the test lane', () => {
    const commands = (id: string) =>
      (LANES.find((lane) => lane.id === id)?.commands ?? []).map((command) => command.join(' '));
    assert.ok(commands('lint').includes('pnpm lint:meta'));
    assert.ok(commands('test').includes('pnpm test:tools'));
  });

  it('runs every lane by default', () => {
    assert.deepEqual(ids([]), ['format', 'lint', 'typecheck', 'test', 'build']);
  });

  it('selects lanes by repeated or comma-separated flags, in declared order', () => {
    assert.deepEqual(ids(['--lane=test', '--lane=typecheck']), ['typecheck', 'test']);
    assert.deepEqual(ids(['--lane=build,format']), ['format', 'build']);
  });

  it('rejects an unknown lane or flag as a usage error', () => {
    assert.throws(() => parseSelection(['--lane=e2e']), UsageError);
    assert.throws(() => parseSelection(['--profile=release']), UsageError);
    assert.throws(() => parseSelection(['--affected=']), UsageError);
  });

  it('reads --affected with and without a base', () => {
    assert.equal(parseSelection([]).affectedBase, null);
    assert.equal(parseSelection(['--affected']).affectedBase, 'origin/main');
    assert.equal(parseSelection(['--affected=HEAD~3']).affectedBase, 'HEAD~3');
  });

  it('adds --affected to turbo tasks only', () => {
    assert.deepEqual(commandFor(['pnpm', 'exec', 'turbo', 'test'], 'origin/main'), [
      'pnpm',
      'exec',
      'turbo',
      'test',
      '--affected',
    ]);
    assert.deepEqual(commandFor(['pnpm', 'test:tools'], 'origin/main'), ['pnpm', 'test:tools']);
    assert.deepEqual(commandFor(['pnpm', 'exec', 'turbo', 'test'], null), [
      'pnpm',
      'exec',
      'turbo',
      'test',
    ]);
  });
});

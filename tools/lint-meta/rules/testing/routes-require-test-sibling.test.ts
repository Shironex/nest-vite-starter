import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { routesRequireTestSiblingRule } from './routes-require-test-sibling';

describe('routes-require-test-sibling', () => {
  it('reports a router with no co-located spec', () => {
    const fixture = createFixture({
      'apps/api/src/modules/example/example.router.ts': '@Router() export class ExampleRouter {}\n',
    });

    const violations = runSync(routesRequireTestSiblingRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'routes-require-test-sibling');
    assert.match(violations[0]?.message ?? '', /`example\.router\.spec\.ts`/u);
  });

  it('passes a router with its spec next to it', () => {
    const fixture = createFixture({
      'apps/api/src/modules/example/example.router.ts': '@Router() export class ExampleRouter {}\n',
      'apps/api/src/modules/example/example.router.spec.ts': "it('works', () => {});\n",
    });

    assert.deepEqual(runSync(routesRequireTestSiblingRule, fixture.context()), []);
  });

  it('does not accept a spec in a different directory', () => {
    const fixture = createFixture({
      'apps/api/src/modules/example/example.router.ts': '@Router() export class ExampleRouter {}\n',
      'apps/api/src/modules/other/example.router.spec.ts': "it('works', () => {});\n",
    });

    assert.equal(runSync(routesRequireTestSiblingRule, fixture.context()).length, 1);
  });

  it('only polices *.router.ts under apps/api/src', () => {
    const fixture = createFixture({
      'apps/api/src/modules/example/example.service.ts': 'export class S {}\n',
      'apps/web/src/example.router.ts': 'export const router = {};\n',
      'packages/shared/src/example.router.ts': 'export const router = {};\n',
    });

    assert.deepEqual(runSync(routesRequireTestSiblingRule, fixture.context()), []);
  });

  it('reports each router that is missing a spec', () => {
    const fixture = createFixture({
      'apps/api/src/modules/a/a.router.ts': 'export class A {}\n',
      'apps/api/src/modules/b/b.router.ts': 'export class B {}\n',
      'apps/api/src/modules/b/b.router.spec.ts': "it('works', () => {});\n",
    });

    const violations = runSync(routesRequireTestSiblingRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.file ?? '', /a\.router\.ts$/u);
  });
});

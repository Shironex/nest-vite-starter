import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkProceduresRequireGuard,
  PUBLIC_PROCEDURES,
  type IGuardConfig,
} from './procedures-require-guard';

const FILE = 'apps/api/src/modules/example/example.router.ts';

const CONFIG: IGuardConfig = {
  guards: ['AuthMiddleware', 'ApiKeyMiddleware'],
  publicProcedures: [
    { router: 'example', procedure: 'open', reason: 'Fixture: public on purpose.' },
  ],
};

function check(source: string, config: IGuardConfig = CONFIG) {
  return checkProceduresRequireGuard([{ file: FILE, source }], config);
}

describe('procedures-require-guard', () => {
  it('passes a procedure guarded at the class level', () => {
    const source = `
      @Router({ alias: 'example' })
      @UseMiddlewares(AuthMiddleware)
      export class ExampleRouter {
        @Query({ output: listOutput })
        list() { return []; }
        @Mutation({ input: openInput, output: ackOutput })
        open() { return { ok: true }; }
      }
    `;
    // Nothing listed: the class guard alone covers both procedures.
    const violations = check(source, { ...CONFIG, publicProcedures: [] });
    assert.deepEqual(violations, []);
  });

  it('passes a procedure guarded at the method level, alongside other middlewares', () => {
    const source = `
      @Router({ alias: 'example' })
      export class ExampleRouter {
        @Mutation({ input: createInput, output: createOutput })
        @UseMiddlewares(
          AuthMiddleware,
          AdminMiddleware,
          ThrottleMiddleware,
        )
        create() { return {}; }
        @UseMiddlewares(AuthMiddleware, ApiKeyMiddleware)
        @Query({ output: listOutput })
        list() { return []; }
        @Mutation({ output: ackOutput })
        open() { return { ok: true }; }
      }
    `;
    assert.deepEqual(check(source), []);
  });

  it('reports an unguarded procedure that is not listed as public', () => {
    const source = `
      @Router({ alias: 'example' })
      export class ExampleRouter {
        @Mutation({ output: ackOutput })
        open() { return { ok: true }; }
        @Query({ output: secretOutput })
        secret(@Input() input: { id: string }) { return this.service.get(input.id); }
      }
    `;
    const violations = check(source);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'procedures-require-guard');
    assert.match(
      violations[0]?.message ?? '',
      /ExampleRouter\.secret \(example\.secret\) at .*:7 has no auth guard/u,
    );
  });

  it('does not accept a non-auth middleware as a guard', () => {
    const source = `
      @Router({ alias: 'example' })
      @UseMiddlewares(ThrottleMiddleware)
      export class ExampleRouter {
        @Mutation({ output: ackOutput })
        open() { return { ok: true }; }
        @Mutation({ output: ackOutput })
        write() { return { ok: true }; }
      }
    `;
    const violations = check(source);
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /example\.write/u);
  });

  it('keys the public list by router alias, not class name', () => {
    const source = `
      @Router({ alias: 'other' })
      export class ExampleRouter {
        @Mutation({ output: ackOutput })
        open() { return { ok: true }; }
      }
    `;
    const messages = check(source).map((violation) => violation.message);
    assert.equal(messages.length, 2);
    assert.match(messages[0] ?? '', /other\.open\) .* has no auth guard/u);
    assert.match(messages[1] ?? '', /lists example\.open, which no router declares/u);
  });

  it('reports a listed procedure that is now guarded as a stale entry', () => {
    const source = `
      @Router({ alias: 'example' })
      export class ExampleRouter {
        @Mutation({ output: ackOutput })
        @UseMiddlewares(AuthMiddleware)
        open() { return { ok: true }; }
      }
    `;
    const violations = check(source);
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /guarded but still listed in PUBLIC_PROCEDURES/u);
  });

  it('reports a listed procedure that no router declares', () => {
    const violations = check(`@Router({ alias: 'example' }) export class ExampleRouter {}`);
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /lists example\.open, which no router declares\./u);
  });

  it('reports a public entry with an empty reason', () => {
    const source = `
      @Router({ alias: 'example' })
      export class ExampleRouter {
        @Mutation({ output: ackOutput })
        open() { return { ok: true }; }
      }
    `;
    const violations = check(source, {
      ...CONFIG,
      publicProcedures: [{ router: 'example', procedure: 'open', reason: '  ' }],
    });
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /has no reason/u);
  });

  it('ignores undecorated methods and classes that are not routers', () => {
    const source = `
      export class Helper {
        @Query({ output: listOutput })
        list() { return []; }
      }
      @Router({ alias: 'example' })
      export class ExampleRouter {
        private helper() { return 1; }
        @Mutation({ output: ackOutput })
        open() { return { ok: true }; }
      }
    `;
    assert.deepEqual(check(source), []);
  });

  it('ships a reason for every seeded public procedure', () => {
    for (const entry of PUBLIC_PROCEDURES) {
      assert.ok(entry.reason.trim().length > 0, `${entry.router}.${entry.procedure}`);
    }
  });
});

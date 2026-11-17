import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readProcedures } from './trpc-procedures';

const FILE = 'apps/api/src/modules/example/example.router.ts';

function read(source: string) {
  return readProcedures({ file: FILE, source });
}

describe('readProcedures', () => {
  it('reads the router alias, the procedure kind and both middleware levels', () => {
    const [procedure, ...rest] = read(`
@Router({ alias: 'example' })
@UseMiddlewares(AuthMiddleware, AdminMiddleware)
export class ExampleRouter {
  @Query({ output: listOutput })
  @UseMiddlewares(RateLimitMiddleware)
  list() {
    return [];
  }
}
`);

    assert.deepEqual(rest, []);
    assert.equal(procedure?.file, FILE);
    assert.equal(procedure?.className, 'ExampleRouter');
    assert.equal(procedure?.router, 'example');
    assert.equal(procedure?.procedure, 'list');
    assert.equal(procedure?.kind, 'Query');
    assert.deepEqual(procedure?.classMiddlewares, ['AuthMiddleware', 'AdminMiddleware']);
    assert.deepEqual(procedure?.methodMiddlewares, ['RateLimitMiddleware']);
    assert.equal(procedure?.hasOutput, true);
  });

  it('falls back to the class name when @Router declares no alias', () => {
    const [procedure] = read(`
@Router()
export class BareRouter {
  @Mutation()
  save() {}
}
`);

    assert.equal(procedure?.router, 'BareRouter');
    assert.equal(procedure?.kind, 'Mutation');
    assert.equal(procedure?.hasOutput, false);
  });

  it('reports the 1-based line of the method name, not of the decorator', () => {
    const [procedure] = read(
      ['@Router()', 'export class R {', '  @Query()', '  list() {}', '}', ''].join('\n'),
    );

    assert.equal(procedure?.line, 4);
  });

  it('reads options that span lines and nest objects, which is where a regex goes wrong', () => {
    const [procedure] = read(`
@Router({
  alias:
    'spread',
})
export class SpreadRouter {
  @Query({
    input: z.object({
      nested: z.object({ output: z.string() }),
    }),
  })
  list() {}
}
`);

    // `output` appears only inside the nested input schema, so it does not count.
    assert.equal(procedure?.router, 'spread');
    assert.equal(procedure?.hasOutput, false);
  });

  it('reports an unreadable options object as null rather than guessing', () => {
    const [spread] = read(`
@Router()
export class R {
  @Query({ ...shared })
  list() {}
}
`);
    const [identifier] = read(`
@Router()
export class R {
  @Query(options)
  list() {}
}
`);

    assert.equal(spread?.hasOutput, null);
    assert.equal(identifier?.hasOutput, null);
  });

  it('ignores methods that are not procedures, and classes that are not routers', () => {
    assert.deepEqual(
      read(`
@Router()
export class R {
  private helper() {}
}

@Injectable()
export class NotARouter {
  @Query()
  list() {}
}
`),
      [],
    );
  });
});

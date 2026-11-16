import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkProcedureRequiresOutput } from './procedure-requires-output';

const FILE = 'apps/api/src/modules/example/example.router.ts';

function check(body: string) {
  const source = `
    @Router({ alias: 'example' })
    @UseMiddlewares(AuthMiddleware)
    export class ExampleRouter {
      ${body}
    }
  `;
  return checkProcedureRequiresOutput([{ file: FILE, source }]);
}

describe('procedure-requires-output', () => {
  it('passes procedures that declare output, inline or shorthand', () => {
    const violations = check(`
      @Query({ input: listInput, output: listOutput })
      list() { return []; }
      @Mutation({
        input: createInput,
        output,
      })
      create() { return {}; }
      @Query({ ...shared, output: getOutput })
      get() { return {}; }
    `);
    assert.deepEqual(violations, []);
  });

  it('reports a procedure whose options have no output', () => {
    const violations = check(`
      @Mutation({ input: createInput })
      create() { return {}; }
    `);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'procedure-requires-output');
    assert.match(
      violations[0]?.message ?? '',
      /@Mutation ExampleRouter\.create at .*:7 declares no `output`/u,
    );
  });

  it('reports a procedure decorator with no options at all', () => {
    const violations = check(`
      @Query()
      list() { return []; }
    `);
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /declares no `output`/u);
  });

  it('reports options it cannot read, failing closed', () => {
    const violations = check(`
      @Query(listOptions)
      list() { return []; }
      @Mutation({ ...createOptions })
      create() { return {}; }
    `);
    assert.equal(violations.length, 2);
    for (const violation of violations) {
      assert.match(
        violation.message,
        /cannot be read here \(a variable or a spread\), so `output` cannot be verified/u,
      );
    }
  });

  it('ignores methods that are not procedures', () => {
    assert.deepEqual(check(`helper() { return 1; }`), []);
  });
});

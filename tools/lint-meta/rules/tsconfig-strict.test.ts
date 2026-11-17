import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture } from '../test-support';
import { checkTsconfigStrict } from './tsconfig-strict';

const BASE = `{
  // the floor
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}`;

describe('tsconfig-strict', () => {
  it('passes a strict base and projects that leave the flags alone', () => {
    const fixture = createFixture({
      'packages/tsconfig/base.json': BASE,
      'apps/api/tsconfig.json': '{ "extends": "@repo/tsconfig/base.json" }',
    });
    assert.deepEqual(checkTsconfigStrict(fixture.ctx()), []);
  });

  it('reports a base that drops a strictness flag', () => {
    const fixture = createFixture({
      'packages/tsconfig/base.json': BASE.replace('"strict": true', '"strict": false'),
    });
    const messages = checkTsconfigStrict(fixture.ctx()).map((violation) => violation.message);
    assert.ok(messages.some((message) => /must set "strict": true/u.test(message)));
  });

  it('reports a project that turns a strictness flag off', () => {
    const fixture = createFixture({
      'packages/tsconfig/base.json': BASE,
      'apps/web/tsconfig.app.json':
        '{ "compilerOptions": { "strictNullChecks": false, "noImplicitAny": false } }',
    });
    const violations = checkTsconfigStrict(fixture.ctx());
    assert.deepEqual(
      violations.map((violation) => violation.file),
      ['apps/web/tsconfig.app.json', 'apps/web/tsconfig.app.json'],
    );
    assert.match(violations[0]?.message ?? '', /"strictNullChecks": false/u);
  });

  it('ignores a flag that is only mentioned in a comment', () => {
    const fixture = createFixture({
      'packages/tsconfig/base.json': BASE,
      'apps/api/tsconfig.json': '{\n  // never set "strict": false here\n  "extends": "x"\n}',
    });
    assert.deepEqual(checkTsconfigStrict(fixture.ctx()), []);
  });
});

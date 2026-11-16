import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toPosix } from './source-scope';

describe('toPosix', () => {
  it('normalizes Windows separators and leaves a posix path alone', () => {
    assert.equal(toPosix('C:\\checkout\\apps\\api\\src\\a.ts'), 'C:/checkout/apps/api/src/a.ts');
    assert.equal(toPosix('apps/api/src/a.ts'), 'apps/api/src/a.ts');
  });
});

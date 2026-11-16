import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { checkRouteI18nSideEffect, routeI18nSideEffectRule } from './route-i18n-side-effect';

const ROUTE = 'apps/web/src/routes/invoices.tsx';

describe('route-i18n-side-effect', () => {
  it('reports a route file that registers a feature catalog by side effect', () => {
    const fixture = createFixture({
      [ROUTE]: "import '@/features/invoices/Invoices.i18n';\nexport const Route = {};\n",
    });

    const violations = runSync(routeI18nSideEffectRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'route-i18n-side-effect');
    assert.match(violations[0]?.message ?? '', /import '@\/features\/invoices\/Invoices\.i18n';/u);
  });

  it('reports every side-effect catalog in the file, in either quote style', () => {
    const fixture = createFixture({
      [ROUTE]: 'import "./A.i18n";\nimport \'./B.i18n\';\n',
    });

    assert.equal(runSync(routeI18nSideEffectRule, fixture.context()).length, 2);
  });

  it('passes a named import of a catalog, which is tree-shakeable', () => {
    const fixture = createFixture({
      [ROUTE]: "import { invoicesCatalog } from '@/features/invoices/Invoices.i18n';\n",
    });

    assert.deepEqual(runSync(routeI18nSideEffectRule, fixture.context()), []);
  });

  it('exempts a route test, which must register the catalog itself', () => {
    const fixture = createFixture({
      'apps/web/src/routes/invoices.test.tsx': "import '@/features/invoices/Invoices.i18n';\n",
      'apps/web/src/routes/invoices.test.ts': "import '@/features/invoices/Invoices.i18n';\n",
    });

    assert.deepEqual(runSync(routeI18nSideEffectRule, fixture.context()), []);
  });

  it('allows the side-effect import in a component outside routes/', () => {
    const fixture = createFixture({
      'apps/web/src/features/invoices/components/Invoices.tsx': "import './Invoices.i18n';\n",
    });

    assert.deepEqual(runSync(routeI18nSideEffectRule, fixture.context()), []);
  });

  it('only matches a whole-line import statement', () => {
    const fixture = createFixture({
      [ROUTE]: "// import '@/features/x/X.i18n';\nconst note = \"import './X.i18n';\";\n",
    });

    assert.deepEqual(runSync(routeI18nSideEffectRule, fixture.context()), []);
  });

  it('exposes the same check the rule runs', () => {
    const fixture = createFixture({ [ROUTE]: "import './A.i18n';\n" });

    assert.equal(checkRouteI18nSideEffect(fixture.context().sourceFiles).length, 1);
  });
});

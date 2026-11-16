import { readFileSync } from 'node:fs';
import { sep } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

/*
 * A route file must not register a feature's i18n catalog.
 *
 * `import '@/features/x/X.i18n';` is a SIDE-EFFECT import, so it is not
 * tree-shakeable and it is not lazy: a route module that carries one pulls that
 * feature's catalogs into the route's static-import closure,
 * and a route module in this app is reached from the router's own graph, which
 * means the catalog lands on first paint. Five of them once did exactly that, at
 * a cost of about 14 kB br of first paint for catalogs most visits never render a string from.
 *
 * The catalog belongs to the component that renders the copy, where it travels
 * with the lazily loaded chunk instead of ahead of it, and where a `*.hooks.ts`
 * rendered in isolation by its own test still has the copy. The five imports
 * moved there and this rule keeps them there, because nothing about removing
 * one fails: the screen renders, the keys resolve because some other route
 * happened to register the same catalog, and the regression is only visible in
 * a byte count.
 *
 * TEST FILES ARE EXEMPT, and they are the reason the rule reads the whole path
 * rather than just the directory. A route's own `*.test.tsx` renders the route
 * without the component tree that would have registered the catalog, so it must
 * register it itself; that import is in a file that never ships.
 */

const ROUTES_FRAGMENT = `${sep}apps${sep}web${sep}src${sep}routes${sep}`;
const TEST_SUFFIXES = ['.test.ts', '.test.tsx'] as const;

/** `import '<anything>/<Name>.i18n';`, the side-effect form and only that form. */
const SIDE_EFFECT_I18N = /^\s*import\s+['"][^'"]*\.i18n['"];/gmu;

export function checkRouteI18nSideEffect(sourceFiles: readonly string[]): IViolation[] {
  const violations: IViolation[] = [];

  for (const file of sourceFiles) {
    if (!file.includes(ROUTES_FRAGMENT)) continue;
    if (TEST_SUFFIXES.some((suffix) => file.endsWith(suffix))) continue;

    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(SIDE_EFFECT_I18N)) {
      violations.push({
        file,
        rule: 'route-i18n-side-effect',
        message: `Route file registers an i18n catalog (\`${match[0].trim()}\`). A side-effect import is neither lazy nor tree-shakeable, so the catalog lands on first paint. Move it into the component that renders the copy, beside its own \`import './X.i18n';\`.`,
      });
    }
  }

  return violations;
}

/** Feature i18n catalogs must be registered by components, never by route files. */
export const routeI18nSideEffectRule: IMetaRule = {
  id: 'route-i18n-side-effect',
  category: 'source-text',
  ciCritical: true,
  description:
    'Route files must not carry side-effect feature i18n imports, which put a catalog on first paint.',
  run({ sourceFiles }: IMetaContext): IViolation[] {
    return checkRouteI18nSideEffect(sourceFiles);
  },
};

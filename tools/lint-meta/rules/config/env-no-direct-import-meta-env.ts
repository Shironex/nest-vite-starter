import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

/*
 * One module owns every `VITE_*` read.
 *
 * A key read in two places grows two defaults and two "is it set" tests, and
 * the day they disagree is the day a production build quietly behaves like a
 * development one. The web app's Sentry DSN was read twice for exactly that
 * reason. `apps/web/src/lib/env.ts` is where a key, its type and its default
 * meet, so adding one is a single edit and reading one has a single answer.
 *
 * `DEV`, `PROD` and `MODE` are NOT covered, on purpose. Vite substitutes those
 * three literally at build time and dead-code elimination depends on seeing
 * them at the branch; routed through a module they become ordinary imports, the
 * branch stays live, and every development-only block ships to users.
 */
export const ENV_MODULE = 'apps/web/src/lib/env.ts';

const WEB_SOURCE = 'apps/web/src/';

/** A build-time key read straight off `import.meta.env`, `VITE_`-prefixed only. */
const DIRECT_READ = /\bimport\s*\.\s*meta\s*\.\s*env\s*\.\s*(VITE_[A-Z0-9_]*)/u;

export function checkEnvNoDirectImportMetaEnv(ctx: IMetaContext): IViolation[] {
  const violations: IViolation[] = [];

  for (const file of ctx.sourceFiles) {
    const display = relative(ctx.root, file).split(sep).join('/');
    if (!display.startsWith(WEB_SOURCE) || display === ENV_MODULE) {
      continue;
    }

    for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
      const match = DIRECT_READ.exec(line);
      if (match === null) {
        continue;
      }
      violations.push({
        file: display,
        rule: 'env-no-direct-import-meta-env',
        message: `Line ${String(index + 1)}: \`${match[1] ?? ''}\` is read directly. Give it a named export in ${ENV_MODULE} (with its default and its type in src/vite-env.d.ts) and import that, so the key has one default and one "is it set" test. \`import.meta.env.DEV\`, \`.PROD\` and \`.MODE\` stay inline: Vite substitutes those at the branch and dead-code elimination depends on it.`,
      });
    }
  }

  return violations;
}

/** Only src/lib/env.ts reads a `VITE_*` key off import.meta.env. */
export const envNoDirectImportMetaEnvRule: IMetaRule = {
  id: 'env-no-direct-import-meta-env',
  category: 'config',
  ciCritical: true,
  description:
    'Only apps/web/src/lib/env.ts may read a VITE_* key off import.meta.env; DEV, PROD and MODE stay inline so Vite can still eliminate dead branches.',
  run(ctx: IMetaContext): IViolation[] {
    return checkEnvNoDirectImportMetaEnv(ctx);
  },
};

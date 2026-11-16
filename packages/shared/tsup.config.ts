import { defineConfig } from 'tsup';

/**
 * One entry per public subpath, plus one per schema domain.
 *
 * The domain entries exist for the BUNDLE, not for the import surface: with
 * `splitting` on, a module reachable from two entries is emitted as its own
 * chunk instead of being inlined into each, so `dist/schemas/index.js` becomes
 * a set of re-exports over per-domain files rather than one 108 kB module.
 *
 * That distinction is what a consuming bundler needs. Rollup chunks at module
 * granularity, so a single opaque barrel means the sign-in page downloads the
 * union of everything all 22 importing chunks reference: it pulled 16 kB br of
 * schemas to read one constant. Split per domain, it pulls the domains it uses.
 */
const SCHEMA_DOMAINS = [
  'audit',
  'auth',
  'common',
  'data-export',
  'workspace',
  'help',
  'notifications',
  'sessions',
  'storage',
  'user',
] as const;

export default defineConfig({
  entry: {
    'schemas/index': 'src/schemas/index.ts',
    ...Object.fromEntries(
      SCHEMA_DOMAINS.map((domain) => [`schemas/${domain}`, `src/schemas/${domain}.ts`]),
    ),
    'types/index': 'src/types/index.ts',
    'constants/index': 'src/constants/index.ts',
    'errors/index': 'src/errors/index.ts',
    'logger/index': 'src/logger/index.ts',
    'permissions/index': 'src/permissions/index.ts',
    'events/index': 'src/events/index.ts',
    'money/index': 'src/money/index.ts',
    'audit/index': 'src/audit/index.ts',
    'desktop/index': 'src/desktop/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  // ESM only: esbuild does not split CJS, and tsup falls back to bundling it
  // per entry, which is what apps/api (compiled to CJS) already consumes.
  splitting: true,
  sourcemap: true,
});

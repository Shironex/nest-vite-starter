import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fail, repoRoot, toKebab, toPascal, toScreamingSnake, writeNew } from './codegen-utils';

const raw = process.argv[2];
if (!raw) fail('usage: pnpm new:feature <Name>');

const dir = toKebab(raw);
const name = toPascal(raw);
const base = `apps/web/src/features/${dir}`;

if (existsSync(join(repoRoot, base))) {
  fail(`feature "${dir}" already exists at ${base}`);
}

writeNew(`${base}/${name}.types.ts`, featureTypes(name));
writeNew(`${base}/${name}.queries.ts`, featureQueries(name));
writeNew(`${base}/${name}.mutations.ts`, featureMutations(name));
writeNew(`${base}/${name}.constants.ts`, featureConstants(name));
writeNew(`${base}/locales/en.json`, featureLocale(name));
writeNew(`${base}/${name}.i18n.ts`, featureI18n(dir, name));

console.log(`\n  feature "${dir}" scaffolded. Add components with:`);
console.log(`    pnpm new:component ${dir}/<Name>`);
console.log(`\n  the generated component imports ${name}.i18n for side effect, so the`);
console.log(`  namespace registers itself. Write the copy in locales/en.json, and add the`);
console.log(`  purpose line the generated module map asks for:`);
console.log(`    tools/arch/registry.ts  ->  WEB_FEATURE_PURPOSES`);
console.log(`    '${dir}': '<one sentence: what this domain is FOR>',`);
console.log(`  then run pnpm generate:arch-map\n`);

function featureTypes(name: string): string {
  return `/** The view model this feature renders. */
export interface I${name}View {
  readonly placeholder: string;
}
`;
}

function featureQueries(name: string): string {
  return `import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';

// TODO: replace user.me with this feature's own tRPC procedure. Read the query
// key from the option proxy (trpc.<router>.<procedure>.queryOptions()), never a
// hand-written array. The result type flows from the procedure's output schema
// through the generated AppRouter (mirrors features/dashboard); never cast it.
export function use${name}() {
  return useQuery({ ...trpc.user.me.queryOptions() });
}
`;
}

function featureMutations(name: string): string {
  return `import { useMutation } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';

// TODO: replace user.updateAvatar with this feature's own tRPC mutation. Spread
// the mutation options from the option proxy
// (trpc.<router>.<procedure>.mutationOptions()), never a hand-written object.
// The types flow from the procedure's schemas through the generated AppRouter;
// never cast them.
export function use${name}Mutation() {
  return useMutation({
    ...trpc.user.updateAvatar.mutationOptions(),
  });
}
`;
}

function featureConstants(name: string): string {
  return `// Frozen, feature-root constants. Add static config this feature shares here.
export const ${toScreamingSnake(name)}_CONSTANTS = {} as const;
`;
}

/*
 * The namespace registration, mirroring features/audit/Audit.i18n.ts. Emitted
 * by the generator rather than printed for the user to write by hand: every
 * feature that owns a `locales/` folder needs exactly this file, and a catalog
 * nobody registers renders raw keys.
 *
 * English is the only language and is passed as the parsed JSON, because it is
 * what every session renders (see "ADDING A LANGUAGE" in `@/lib/i18n` for how a
 * second one is registered).
 */
function featureI18n(dir: string, name: string): string {
  return `import { registerFeatureNamespace } from '@/lib/i18n';
import en from './locales/en.json';

/**
 * Attach this feature's catalogs under the \`${dir}\` namespace.
 *
 * Imported for side effect from this feature's components, never from a route:
 * a route-level side-effect import is neither lazy nor tree-shakeable, so the
 * catalog would land on first paint (\`route-i18n-side-effect\`).
 */
registerFeatureNamespace('${dir}', { en });

/** The namespace name, so callers do not repeat the string literal. */
export const ${toScreamingSnake(name)}_NS = '${dir}';
`;
}

// One namespace per feature, one English catalog per namespace. Shared copy (actions, states, AppErrorCode sentences) belongs in
// src/lib/i18n/locales, never here: a feature must never import another
// feature's locales (no-cross-feature-imports).
function featureLocale(name: string): string {
  return `{
  "title": "${name}"
}
`;
}

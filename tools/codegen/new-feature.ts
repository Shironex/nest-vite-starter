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
writeNew(`${base}/${name}.strings.ts`, featureStrings(name));

console.log(`\n  feature "${dir}" scaffolded. Add components with:`);
console.log(`    pnpm new:component ${dir}/<Name>`);
console.log(`\n  the generated component renders its copy from ${name}.strings.ts. Write the`);
console.log(`  feature's copy there, and add the`);
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

// TODO: replace workspaces.update with this feature's own tRPC mutation. Spread
// the mutation options from the option proxy
// (trpc.<router>.<procedure>.mutationOptions()), never a hand-written object.
// The types flow from the procedure's schemas through the generated AppRouter;
// never cast them.
export function use${name}Mutation() {
  return useMutation({
    ...trpc.workspaces.update.mutationOptions(),
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
 * The feature's copy table: a plain `as const` object, one per feature, with a
 * small function for any entry that interpolates or pluralizes. Copy shared by
 * more than one feature belongs in src/lib/strings.ts, never here: a feature must
 * never import another feature's strings (no-cross-feature-imports).
 */
function featureStrings(name: string): string {
  const table = `${name.charAt(0).toLowerCase()}${name.slice(1)}Strings`;
  return `/** English copy for this feature. Interpolated entries are small functions. */
export const ${table} = {
  title: '${name}',
} as const;
`;
}

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPascalCase, fail, repoRoot, toKebab, writeNew } from './codegen-utils';

/** A feature's strings table, as the generated component imports it. */
interface IFeatureStrings {
  /** Import specifier of the table, e.g. `@/features/admin/Admin.strings`. */
  readonly module: string;
  /** The exported table, e.g. `auditStrings`. */
  readonly table: string;
  /** The English copy under `title`, which is what the generated shell renders. */
  readonly title: string;
}

const arg = process.argv[2];
if (!arg || !arg.includes('/')) {
  fail('usage: pnpm new:component <feature>/<Name>   (or)   pnpm new:component ui/<Name>');
}

const slash = arg.indexOf('/');
const target = arg.slice(0, slash);
const rawName = arg.slice(slash + 1);
if (!rawName) fail('missing component name');

if (target === 'ui') {
  generateUiComponent(rawName);
} else {
  generateFeatureComponent(target, rawName);
}

// ---------------------------------------------------------------------------
// Feature component: the 5-file folder convention under apps/web, as
// apps/web/src/features/README.md defines it (shell, hooks, types, test,
// barrel).
// ---------------------------------------------------------------------------

function generateFeatureComponent(feature: string, rawName: string): void {
  const name = rawName;
  assertPascalCase(name, 'component name');

  const featureDir = `apps/web/src/features/${feature}`;
  if (!existsSync(join(repoRoot, featureDir))) {
    fail(`feature "${feature}" does not exist. Create it first: pnpm new:feature ${feature}`);
  }

  const dir = `${featureDir}/components/${name}`;
  const kebab = toKebab(name);
  const strings = featureStringsModule(feature, featureDir);

  writeNew(`${dir}/${name}.tsx`, componentShell(name, kebab));
  writeNew(`${dir}/${name}.hooks.ts`, componentHooks(name, strings));
  writeNew(`${dir}/${name}.types.ts`, componentTypes(name));
  writeNew(`${dir}/${name}.test.tsx`, componentTest(name, strings?.title ?? name));
  writeNew(`${dir}/index.ts`, componentBarrel(name));

  console.log(
    `\n  ${name} scaffolded under features/${feature}. Render it from a route or parent.\n`,
  );
}

/*
 * The feature's `<Name>.strings.ts` and the `title` it holds, or null for a
 * feature that ships no copy table of its own. `pnpm new:feature` always writes
 * one; a hand-made feature may not have it, and a component there must not
 * import a module that does not exist. The title is what the generated shell
 * renders and what the generated test asserts, so a table without one falls
 * back to the plain, copy-free shell.
 */
function featureStringsModule(feature: string, featureDir: string): IFeatureStrings | null {
  const file = readdirSync(join(repoRoot, featureDir)).find((entry) =>
    entry.endsWith('.strings.ts'),
  );
  if (file === undefined) {
    return null;
  }

  const source = readFileSync(join(repoRoot, featureDir, file), 'utf8');
  const table = /export const (\w+Strings)\b/u.exec(source)?.[1];
  const title = /^\s*title:\s*'([^']*)'/mu.exec(source)?.[1];
  if (table === undefined || title === undefined) {
    return null;
  }

  return {
    module: `@/features/${feature}/${file.slice(0, -'.ts'.length)}`,
    table,
    title,
  };
}

function componentShell(name: string, kebab: string): string {
  return `import { cn } from '@repo/ui/lib/utils';
import { use${name} } from './${name}.hooks';

export default function ${name}() {
  const { label } = use${name}();
  const containerClass = cn('flex flex-col gap-2');

  return (
    <div className={containerClass} data-slot="${kebab}">
      {label}
    </div>
  );
}
`;
}

function componentHooks(name: string, strings: IFeatureStrings | null): string {
  if (strings === null) {
    return `import type { I${name}View } from './${name}.types';

export function use${name}(): I${name}View {
  // TODO: own this component's state, tRPC queryOptions/mutationOptions, and
  // store reads here so the component stays a thin presentational shell.
  return { label: '${name}' };
}
`;
  }

  return `import { ${strings.table} } from '${strings.module}';
import type { I${name}View } from './${name}.types';

export function use${name}(): I${name}View {
  // TODO: own this component's state, tRPC queryOptions/mutationOptions, and
  // store reads here so the component stays a thin presentational shell. Copy
  // comes from the feature's strings table, never from a literal.
  return { label: ${strings.table}.title };
}
`;
}

function componentTypes(name: string): string {
  return `export interface I${name}View {
  readonly label: string;
}
`;
}

/*
 * `label` is the feature strings table's `title` once the feature owns copy, so
 * the assertion is on the rendered copy rather than on the component name.
 */
function componentTest(name: string, label: string): string {
  return `import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ${name} from './${name}';

describe('${name}', () => {
  it('renders', () => {
    render(<${name} />);
    expect(screen.getByText('${label}')).toBeInTheDocument();
  });
});
`;
}

function componentBarrel(name: string): string {
  return `export { default as ${name} } from './${name}';
export * from './${name}.types';
`;
}

// ---------------------------------------------------------------------------
// UI component: a single-file shadcn-style component in @repo/ui, plus its
// package export entry.
// ---------------------------------------------------------------------------

function generateUiComponent(rawName: string): void {
  const name = rawName;
  assertPascalCase(name, 'component name');
  const kebab = toKebab(name);

  writeNew(`packages/ui/src/components/${kebab}.tsx`, uiComponent(name, kebab));
  registerUiExport(kebab);

  console.log(`\n  ${name} scaffolded in @repo/ui. Import it from '@repo/ui/${kebab}'.\n`);
}

function uiComponent(name: string, kebab: string): string {
  return `'use client';

import * as React from 'react';

import { cn } from '@repo/ui/lib/utils';

interface I${name}Props extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional visual label. */
  label?: string;
}

const ${name} = React.forwardRef<HTMLDivElement, I${name}Props>(
  ({ className, label, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="${kebab}"
        className={cn('inline-flex items-center', className)}
        {...props}
      >
        {label}
      </div>
    );
  },
);
${name}.displayName = '${name}';

export { ${name}, type I${name}Props };
`;
}

/** Insert a per-subpath export into packages/ui/package.json. */
function registerUiExport(kebab: string): void {
  const pkgPath = 'packages/ui/package.json';
  const pkgAbs = join(repoRoot, pkgPath);
  const pkg = readFileSync(pkgAbs, 'utf8');
  const exportKey = `"./${kebab}"`;

  if (pkg.includes(exportKey)) {
    console.log(`  skipped  ${pkgPath} (export ${exportKey} already present)`);
    return;
  }

  const anchor = '"exports": {\n';
  const idx = pkg.indexOf(anchor);
  if (idx === -1) fail(`could not find an "exports" block in ${pkgPath}`);

  const entry = `    "./${kebab}": {\n      "import": "./src/components/${kebab}.tsx"\n    },\n`;
  const updated = pkg.slice(0, idx + anchor.length) + entry + pkg.slice(idx + anchor.length);
  writeFileSync(pkgAbs, updated);
  console.log(`  updated  ${pkgPath} (added export ${exportKey})`);
}

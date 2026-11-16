import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertPascalCase,
  fail,
  repoRoot,
  toKebab,
  toScreamingSnake,
  writeNew,
} from './codegen-utils';

/** A feature's namespace module, as the generated component imports it. */
interface IFeatureI18n {
  /** Module specifier relative to the component folder's parent, e.g. `Audit.i18n`. */
  readonly module: string;
  /** The exported namespace constant, e.g. `AUDIT_NS`. */
  readonly namespaceConst: string;
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
  const i18n = featureI18nModule(featureDir);

  writeNew(`${dir}/${name}.tsx`, componentShell(name, kebab, i18n));
  writeNew(`${dir}/${name}.hooks.ts`, componentHooks(name, i18n));
  writeNew(`${dir}/${name}.types.ts`, componentTypes(name));
  writeNew(`${dir}/${name}.test.tsx`, componentTest(name, i18n?.title ?? name));
  writeNew(`${dir}/index.ts`, componentBarrel(name));

  console.log(
    `\n  ${name} scaffolded under features/${feature}. Render it from a route or parent.\n`,
  );
}

/*
 * The feature's `<Name>.i18n.ts` and the `title` its English catalog holds, or
 * null for a feature that ships no copy of its own. `pnpm new:feature` always
 * writes both; the older features without a `locales/` folder have neither, and
 * a component there must not import a module that does not exist. The title is
 * what the generated shell renders and what the generated test asserts, so a
 * catalog without one falls back to the plain, copy-free shell.
 */
function featureI18nModule(featureDir: string): IFeatureI18n | null {
  const entries = readdirSync(join(repoRoot, featureDir)).filter((entry) =>
    entry.endsWith('.i18n.ts'),
  );
  const file = entries[0];
  if (file === undefined) {
    return null;
  }

  const localePath = join(repoRoot, featureDir, 'locales', 'en.json');
  if (!existsSync(localePath)) {
    return null;
  }

  const catalog: unknown = JSON.parse(readFileSync(localePath, 'utf8'));
  const title =
    typeof catalog === 'object' && catalog !== null && 'title' in catalog
      ? (catalog as { title: unknown }).title
      : undefined;
  if (typeof title !== 'string') {
    return null;
  }

  const featureName = file.slice(0, -'.i18n.ts'.length);
  return {
    module: `${featureName}.i18n`,
    namespaceConst: `${toScreamingSnake(featureName)}_NS`,
    title,
  };
}

/*
 * Registering the catalog from the COMPONENT, not the route, is what keeps it
 * out of first paint (`route-i18n-side-effect`), and importing it in the hook
 * file too is what keeps a `*.hooks.test.tsx` from rendering raw keys once the
 * component module is mocked away. Both mirror features/audit.
 */
function componentShell(name: string, kebab: string, i18n: IFeatureI18n | null): string {
  const register =
    i18n === null
      ? ''
      : `// Side effect: registers this feature's catalogs. Needed HERE and not only in
// the hook file, because a component test mocks the hook module away, and
// without this import the component would render bare i18n keys under test.
import '../../${i18n.module}';
`;

  return `import { cn } from '@repo/ui/lib/utils';
${register}import { use${name} } from './${name}.hooks';

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

function componentHooks(name: string, i18n: IFeatureI18n | null): string {
  if (i18n === null) {
    return `import type { I${name}View } from './${name}.types';

export function use${name}(): I${name}View {
  // TODO: own this component's state, tRPC queryOptions/mutationOptions, and
  // store reads here so the component stays a thin presentational shell.
  return { label: '${name}' };
}
`;
  }

  return `import { useTranslation } from 'react-i18next';
// Importing the namespace constant also runs the registration, so a hook
// rendered in isolation (a *.hooks.test.tsx) has the copy too.
import { ${i18n.namespaceConst} } from '../../${i18n.module}';
import type { I${name}View } from './${name}.types';

export function use${name}(): I${name}View {
  const { t } = useTranslation(${i18n.namespaceConst});

  // TODO: own this component's state, tRPC queryOptions/mutationOptions, and
  // store reads here so the component stays a thin presentational shell. Copy
  // comes from the feature's locales/, never from a literal.
  return { label: t('title') };
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
 * `label` is the feature catalog's `title` once the feature owns copy, so the
 * assertion is on the rendered catalog string rather than on the component name.
 * That makes the generated test fail if the catalog is never registered, which
 * is the mistake worth catching.
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

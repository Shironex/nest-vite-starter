import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

/*
 * The public surface of the two packages every other workspace imports.
 *
 * The concrete reason this exists: an agent that cannot see `formatMoney`
 * writes a second currency formatter, and nothing fails. A catalog of what is
 * already exported, keyed by the subpath you would import it from, is the
 * cheapest answer to "does this helper exist yet".
 *
 * The subpaths come from each package's `exports` map rather than from the
 * directory listing, because the map is what another workspace can actually
 * reach. Names come from the TypeScript AST of the entry file, following
 * `export * from './x'` re-exports so a barrel reports what it forwards.
 */

export interface ICatalogEntry {
  /** The import subpath, for example `@repo/shared/money`. */
  readonly specifier: string;
  /** Repo-relative POSIX path of the entry source file. */
  readonly source: string;
  /** Exported names, sorted, `default` included when there is one. */
  readonly names: readonly string[];
}

export interface ICatalogPackage {
  readonly name: string;
  /** Repo-relative POSIX directory of the package. */
  readonly dir: string;
  readonly entries: readonly ICatalogEntry[];
}

export interface IPackageSpec {
  readonly name: string;
  readonly dir: string;
}

export const PACKAGE_SPECS: readonly IPackageSpec[] = [
  { name: '@repo/shared', dir: 'packages/shared' },
  { name: '@repo/ui', dir: 'packages/ui' },
];

function toPosix(value: string): string {
  return value.split(sep).join(posix.sep);
}

/** The `import` condition of an exports-map value, or null for a non-JS asset. */
function importTarget(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.endsWith('.css') ? null : value;
  }

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const imported = record['import'] ?? record['default'];

  if (typeof imported === 'string') {
    return imported;
  }

  if (typeof imported === 'object' && imported !== null) {
    const nested = (imported as Record<string, unknown>)['default'];
    return typeof nested === 'string' ? nested : null;
  }

  return null;
}

/**
 * The source file behind a published target.
 *
 * `@repo/ui` points its exports straight at `src`, `@repo/shared` points at the
 * `dist` tsup writes, so a dist path is mapped back to the source it is built
 * from. A build artifact is never read: a catalog derived from dist would go
 * stale the moment somebody edits without rebuilding.
 */
export function sourceForTarget(packageDirAbsolute: string, target: string): string | null {
  const cleaned = target.replace(/^\.\//u, '');
  const candidates = new Set<string>();

  for (const base of [cleaned, cleaned.replace(/^dist\//u, 'src/')]) {
    const withoutExtension = base.replace(/\.(?:js|cjs|mjs|d\.ts)$/u, '');
    candidates.add(`${withoutExtension}.ts`);
    candidates.add(`${withoutExtension}.tsx`);
    candidates.add(base);
  }

  for (const candidate of candidates) {
    const absolute = join(packageDirAbsolute, ...candidate.split('/'));
    if (existsSync(absolute) && /\.tsx?$/u.test(absolute)) {
      return absolute;
    }
  }

  return null;
}

function resolveRelativeSource(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const base = resolve(dirname(fromFile), specifier).replace(/\.(?:js|jsx)$/u, '');

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function bindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      bindingNames(element.name, out);
    }
  }
}

/** Exported names of one file, following `export * from './x'` into siblings. */
export function exportedNames(file: string, seen: Set<string> = new Set()): string[] {
  if (seen.has(file)) {
    return [];
  }
  seen.add(file);

  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set<string>();

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier;
      const from =
        moduleSpecifier !== undefined && ts.isStringLiteral(moduleSpecifier)
          ? moduleSpecifier.text
          : null;

      if (statement.exportClause === undefined) {
        const target = from === null ? null : resolveRelativeSource(file, from);
        if (target !== null) {
          for (const name of exportedNames(target, seen)) {
            names.add(name);
          }
        }
        continue;
      }

      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text);
        }
      } else {
        names.add(statement.exportClause.name.text);
      }
      continue;
    }

    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      continue;
    }

    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      names.add('default');
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        bindingNames(declaration.name, names);
      }
      continue;
    }

    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

export function scanPackage(root: string, spec: IPackageSpec): ICatalogPackage {
  const packageDirAbsolute = join(root, ...spec.dir.split('/'));
  const manifestPath = join(packageDirAbsolute, 'package.json');

  if (!existsSync(manifestPath)) {
    return { name: spec.name, dir: spec.dir, entries: [] };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    exports?: Record<string, unknown>;
  };
  const entries: ICatalogEntry[] = [];

  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    const target = importTarget(value);
    if (target === null) {
      continue;
    }

    const source = sourceForTarget(packageDirAbsolute, target);
    if (source === null) {
      continue;
    }

    entries.push({
      specifier: posix.join(spec.name, subpath.replace(/^\.\/?/u, '')),
      source: toPosix(relative(root, source)),
      names: exportedNames(source),
    });
  }

  entries.sort((a, b) => a.specifier.localeCompare(b.specifier));

  return { name: spec.name, dir: spec.dir, entries };
}

export function scanPackages(
  root: string,
  specs: readonly IPackageSpec[] = PACKAGE_SPECS,
): ICatalogPackage[] {
  return specs.map((spec) => scanPackage(root, spec));
}

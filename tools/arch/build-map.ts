import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { scanPackages } from './exports';
import { PURPOSES, type IPurposeRegistry } from './registry';
import {
  EXPORTS_CATALOG_PATH,
  MODULE_MAP_PATH,
  purposesFor,
  renderExportsCatalog,
  renderModuleMap,
} from './render';
import { scanGroups } from './scan';

/*
 * `pnpm generate:arch-map` writes the two generated pages; `--check` proves the
 * committed copies match what the tree says today.
 *
 * The check runs inside `pnpm lint:meta` (rule `arch-map-fresh`) rather than as
 * a separate CI step, so it is already inside `pnpm verify`, the pre-push hook
 * and ci.yml with nothing to wire. It compares rendered text rather than
 * shelling out to `git diff`, which means it is also correct on a dirty tree.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface IGeneratedPage {
  /** Repo-relative POSIX path. */
  readonly path: string;
  readonly content: string;
}

export interface IArchProblem {
  readonly file: string;
  readonly message: string;
}

export function buildPages(root: string, registry: IPurposeRegistry = PURPOSES): IGeneratedPage[] {
  return [
    { path: MODULE_MAP_PATH, content: renderModuleMap(scanGroups(root), registry) },
    { path: EXPORTS_CATALOG_PATH, content: renderExportsCatalog(scanPackages(root)) },
  ];
}

/** Directories the generator found that nobody has written a purpose line for. */
export function missingPurposes(
  root: string,
  registry: IPurposeRegistry = PURPOSES,
): IArchProblem[] {
  return scanGroups(root).flatMap((group) => {
    const purposes = purposesFor(registry, group.id);

    return group.units
      .filter((unit) => (purposes[unit.name] ?? '').trim() === '')
      .map((unit) => ({
        file: `${group.dir}/${unit.name}`,
        message: `\`${group.dir}/${unit.name}\` has no purpose line. Add one to tools/arch/registry.ts: a file count is derivable, what the directory is FOR is not.`,
      }));
  });
}

/**
 * Everything wrong with the committed map: a missing purpose line, a page that
 * was never generated, or a page that no longer matches the tree.
 */
export function checkArchMap(root: string, registry: IPurposeRegistry = PURPOSES): IArchProblem[] {
  const problems = missingPurposes(root, registry);

  for (const page of buildPages(root, registry)) {
    const absolute = join(root, ...page.path.split('/'));

    if (!existsSync(absolute)) {
      problems.push({
        file: page.path,
        message: `Generated page is missing. Run \`pnpm generate:arch-map\`.`,
      });
      continue;
    }

    if (readFileSync(absolute, 'utf8') !== page.content) {
      problems.push({
        file: page.path,
        message: `Generated page is out of date with the tree. Run \`pnpm generate:arch-map\` and commit the result.`,
      });
    }
  }

  return problems;
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  const checkMode = argv.includes('--check');

  if (checkMode) {
    const problems = checkArchMap(REPO_ROOT);

    if (problems.length > 0) {
      for (const problem of problems) {
        console.error(`[arch-map] ${problem.file}: ${problem.message}`);
      }
      process.exit(1);
    }

    console.log('[arch-map] the module map and the exports catalog are up to date.');
    return;
  }

  const missing = missingPurposes(REPO_ROOT);
  for (const problem of missing) {
    console.error(`[arch-map] ${problem.file}: ${problem.message}`);
  }

  for (const page of buildPages(REPO_ROOT)) {
    const absolute = join(REPO_ROOT, ...page.path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, page.content, 'utf8');
    console.log(`[arch-map] wrote ${page.path}`);
  }

  if (missing.length > 0) {
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

import { alignedTable } from './markdown-table';
import type { ICatalogPackage } from './exports';
import type { IPurposeMap, IPurposeRegistry } from './registry';
import type { IUnitGroup } from './scan';

/*
 * The two generated pages.
 *
 * They live in apps/docs rather than beside the code because that is where
 * somebody orienting already looks, and because Starlight gives the tables
 * search and anchors for free. Both carry a do-not-edit banner: the page is an
 * artifact, and a hand edit to one is lost on the next `pnpm generate:arch-map`.
 */

const BANNER =
  '<!-- GENERATED FILE. Run `pnpm generate:arch-map` to refresh it; hand edits are overwritten. -->';

export const MODULE_MAP_PATH = 'apps/docs/src/content/docs/architecture/module-map.md';
export const EXPORTS_CATALOG_PATH = 'apps/docs/src/content/docs/architecture/exports-catalog.md';

/** Purposes keyed by the group id `scan.ts` produces. */
export function purposesFor(registry: IPurposeRegistry, groupId: string): IPurposeMap {
  return groupId === 'api-modules' ? registry.apiModules : registry.webFeatures;
}

/** Single-quoted YAML, which is also the form Prettier writes frontmatter in. */
function yamlString(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

/*
 * Both values are quoted. A description reading "... and web features: one
 * purpose line ..." is a second mapping key to the YAML parser, and `astro
 * sync` fails on it rather than on anything a reader would recognize.
 */
function frontmatter(title: string, description: string, order: number): string {
  return [
    '---',
    `title: ${yamlString(title)}`,
    `description: ${yamlString(description)}`,
    'sidebar:',
    `  order: ${order}`,
    '---',
  ].join('\n');
}

function unitsTable(group: IUnitGroup, purposes: IPurposeMap): string {
  return alignedTable(
    ['Directory', 'Purpose', 'Files', 'Fan-out', 'Fan-in'],
    group.units.map((unit) => [
      `\`${unit.name}\``,
      purposes[unit.name] ?? '**MISSING** (add a line to `tools/arch/registry.ts`)',
      String(unit.files),
      String(unit.dependsOn.length),
      String(unit.dependents.length),
    ]),
  );
}

function edgesTable(group: IUnitGroup): string {
  const rows = group.units.flatMap((unit) =>
    unit.dependsOn.map((edge) => {
      const first = edge.witnesses[0];
      const witness = first === undefined ? '' : `\`${first.file}:${first.line}\``;

      return [`\`${unit.name}\``, `\`${edge.to}\``, String(edge.witnesses.length), witness];
    }),
  );

  if (rows.length === 0) {
    return 'No cross-directory imports.';
  }

  return alignedTable(['From', 'To', 'Imports', 'First witness'], rows);
}

function groupSection(group: IUnitGroup, registry: IPurposeRegistry): string {
  const purposes = purposesFor(registry, group.id);

  return [
    `## \`${group.dir}\``,
    '',
    unitsTable(group, purposes),
    '',
    `### Cross-directory edges in \`${group.dir}\``,
    '',
    '`Imports` counts every import line that creates the edge; `First witness` is the lowest one, so',
    'an edge you did not expect can be opened rather than argued about.',
    '',
    edgesTable(group),
  ].join('\n');
}

export function renderModuleMap(groups: readonly IUnitGroup[], registry: IPurposeRegistry): string {
  return [
    frontmatter(
      'Module Map',
      'Generated map of apps/api/src/modules and apps/web/src/features: one purpose line per directory, file counts, fan-in, fan-out, and every cross-directory import with a file:line witness.',
      7,
    ),
    '',
    BANNER,
    '',
    'Every number and every edge below is read off the tree by `tools/arch/build-map.ts`. The only',
    'hand-written column is **Purpose**, which lives in `tools/arch/registry.ts`: a file count is',
    'derivable, what a module is FOR is not. A directory with no purpose line fails the',
    '`arch-map-fresh` lint-meta rule, and so does a stale copy of this page.',
    '',
    'The prose companions are still the place for the reasoning: `apps/api/src/modules/README.md` for',
    'the backend vocabulary and why the module boundaries fall where they do, and',
    '`apps/web/src/features/README.md` for the component folder convention.',
    '',
    ...groups.map((group) => `${groupSection(group, registry)}\n`),
  ].join('\n');
}

/*
 * One bullet per subpath rather than a table. `@repo/shared/schemas` alone
 * publishes several hundred names, and a markdown table pads every row to its
 * widest cell, so the table form produced a 130 kB page nobody could read.
 */
function catalogSection(pkg: ICatalogPackage): string {
  const bullets = pkg.entries.map((entry) => {
    const names =
      entry.names.length === 0
        ? 'nothing (re-export only)'
        : entry.names.map((name) => `\`${name}\``).join(', ');

    return `- \`${entry.specifier}\` (\`${entry.source}\`): ${names}`;
  });

  return [
    `## \`${pkg.name}\``,
    '',
    bullets.length === 0 ? 'No subpath exports.' : bullets.join('\n'),
  ].join('\n');
}

export function renderExportsCatalog(packages: readonly ICatalogPackage[]): string {
  return [
    frontmatter(
      'Package Exports Catalog',
      'Generated catalog of every subpath exported by @repo/shared and @repo/ui, with the names each one publishes, so a helper is found instead of written twice.',
      8,
    ),
    '',
    BANNER,
    '',
    'Read this before writing a helper. The repeated failure it exists for is small and expensive: a',
    'second currency formatter, a second date helper, a second `cn`, written because a grep missed the',
    'one already exported and nothing failed when the duplicate shipped.',
    '',
    'The subpaths come from each package `exports` map, so this is what another workspace can actually',
    'import, not what happens to sit in `src`. Names come from the TypeScript AST of the entry file,',
    'following `export *` re-exports. Regenerate with `pnpm generate:arch-map`.',
    '',
    ...packages.map((pkg) => `${catalogSection(pkg)}\n`),
  ].join('\n');
}

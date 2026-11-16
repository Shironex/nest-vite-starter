/*
 * `pnpm new:module` as a plan: every file a tenant-scoped module needs, as a
 * list of creates and anchored patches computed before anything is written.
 *
 * A hand-added tenant-scoped resource has seven places to remember and each one
 * is a silent failure when forgotten: an unregistered model is not isolated, an
 * unlisted lint model is not policed, a model without a canary mutant is never
 * proven, and a module without an isolation spec has nothing proving the
 * boundary at all. The plan makes them one step.
 *
 * Every patch is anchored on text that must occur EXACTLY ONCE. A missing or
 * repeated anchor refuses the whole plan before any file is touched, rather
 * than guessing where the edit belongs. `applyPlan` writes atomically: it
 * snapshots every file it will touch, and restores all of them (and removes
 * every file it created) when a write or the verification after it fails.
 *
 * This file decides; `new-module.ts` orchestrates the shell steps around it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { toKebab, toScreamingSnake } from '../codegen/codegen-utils';
import {
  isolationCaseNames,
  isolationSpec,
  nestModule,
  prismaModel,
  repository,
  router,
  routerSpec,
  service,
  serviceSpec,
  sharedIndexExport,
  sharedSchemas,
} from './module-templates';

export interface IModuleNames {
  /** `Invoice`: the Prisma model and the class stem. */
  readonly model: string;
  /** `invoice`: the Prisma delegate accessor and the TENANT_SCOPED_MODELS key. */
  readonly accessor: string;
  /** `invoice`: file stem for the service and repository. */
  readonly kebab: string;
  /** `invoices`: module directory, router file stem and audit domain. */
  readonly dir: string;
  /** `invoices`: the tRPC router alias. */
  readonly alias: string;
  /** `INVOICE`: prefix of the audit action constants. */
  readonly screaming: string;
  /** `invoices`: the back-relation field on Tenant. */
  readonly relation: string;
  readonly routerClass: string;
  readonly moduleClass: string;
}

export interface IPolicy {
  readonly id: string;
  readonly summary: string;
  /** The `@UseMiddlewares(...)` on create and update. Reads get the class-level AuthMiddleware. */
  readonly writeMiddlewares: readonly string[];
}

/*
 * The policies, mapped onto the middleware sets the existing routers already
 * use. An unknown policy is refused, never guessed: the whole point is that a
 * missing AdminMiddleware cannot be a typo.
 */
export const POLICIES: Readonly<Record<string, IPolicy>> = {
  'organization-read-write': {
    id: 'organization-read-write',
    summary: 'every member of the organization reads and writes.',
    writeMiddlewares: ['AuthMiddleware', 'IdempotencyMiddleware'],
  },
  'organization-read-admin-write': {
    id: 'organization-read-admin-write',
    summary: 'every member of the organization reads; only an ADMIN writes.',
    writeMiddlewares: ['AuthMiddleware', 'AdminMiddleware', 'IdempotencyMiddleware'],
  },
};

export class PlanRefusedError extends Error {}

export function deriveNames(model: string, plural?: string): IModuleNames {
  if (!/^[A-Z][A-Za-z0-9]*$/u.test(model)) {
    throw new PlanRefusedError(
      `The model name must be PascalCase and singular, e.g. "Invoice" (got "${model}").`,
    );
  }
  const kebab = toKebab(model);
  const dir = plural === undefined ? `${kebab}s` : toKebab(plural);
  if (!/^[a-z][a-z0-9-]*$/u.test(dir) || dir === kebab) {
    throw new PlanRefusedError(
      `The plural must differ from the singular and be kebab-case (got "${dir}").`,
    );
  }
  const camelPlural = dir.replace(/-([a-z0-9])/gu, (_, char: string) => char.toUpperCase());
  const pascalPlural = camelPlural.charAt(0).toUpperCase() + camelPlural.slice(1);
  return {
    model,
    accessor: model.charAt(0).toLowerCase() + model.slice(1),
    kebab,
    dir,
    alias: camelPlural,
    screaming: toScreamingSnake(model),
    relation: camelPlural,
    routerClass: `${pascalPlural}Router`,
    moduleClass: `${pascalPlural}Module`,
  };
}

export function resolvePolicy(id: string | undefined): IPolicy {
  const policy = id === undefined ? undefined : POLICIES[id];
  if (policy === undefined) {
    throw new PlanRefusedError(
      `--policy is required and must be one of: ${Object.keys(POLICIES).join(', ')} (got ${id === undefined ? 'nothing' : `"${id}"`}).`,
    );
  }
  return policy;
}

export type PlanEdit =
  | { readonly kind: 'create'; readonly path: string; readonly content: string }
  | {
      readonly kind: 'patch';
      readonly path: string;
      readonly before: string;
      readonly content: string;
    };

/** Paths the plan patches, relative to the repo root. */
export const PATCHED = {
  tenancySchema: 'packages/database/prisma/schema/tenancy.prisma',
  scopeRegistry: 'apps/api/src/common/database/tenant-scope.extension.ts',
  lintTenantModels: 'packages/eslint-plugin-repo/src/utils/tenant-registry.ts',
  canaryManifest: 'tools/canary/isolation-canary.json',
  coverageSpec: 'apps/api/src/common/database/tenant-scope-coverage.isolation.spec.ts',
  appModule: 'apps/api/src/app.module.ts',
  sharedIndex: 'packages/shared/src/schemas/index.ts',
  auditActions: 'packages/shared/src/audit/index.ts',
  auditCatalogEn: 'apps/web/src/features/audit/locales/en.json',
  archRegistry: 'tools/arch/registry.ts',
} as const;

/** Insert `insertion` before (or after) the ONLY occurrence of `anchor`, or refuse. */
export function insertAtAnchor(
  source: string,
  anchor: string,
  insertion: string,
  where: 'before' | 'after',
  file: string,
): string {
  const first = source.indexOf(anchor);
  if (first === -1) {
    throw new PlanRefusedError(
      `${file}: the anchor ${JSON.stringify(anchor)} is missing, so the edit has no safe place.`,
    );
  }
  if (source.indexOf(anchor, first + 1) !== -1) {
    throw new PlanRefusedError(
      `${file}: the anchor ${JSON.stringify(anchor)} occurs more than once, so the edit is ambiguous.`,
    );
  }
  const at = where === 'before' ? first : first + anchor.length;
  return source.slice(0, at) + insertion + source.slice(at);
}

/** The closing brace of one named block (`model Tenant {` ... `\n}`), located by its header. */
function closingBraceOf(source: string, header: string, file: string): number {
  const start = source.indexOf(header);
  if (start === -1 || source.indexOf(header, start + 1) !== -1) {
    throw new PlanRefusedError(`${file}: expected exactly one ${JSON.stringify(header)}.`);
  }
  const end = source.indexOf('\n}', start);
  if (end === -1) throw new PlanRefusedError(`${file}: ${JSON.stringify(header)} is never closed.`);
  return end;
}

/** The text between an opening marker and the first closing marker after it, or refuse. */
function blockOf(source: string, open: string, close: string, file: string): string {
  const start = source.indexOf(open);
  if (start === -1 || source.indexOf(open, start + 1) !== -1) {
    throw new PlanRefusedError(`${file}: expected exactly one ${JSON.stringify(open)}.`);
  }
  const end = source.indexOf(close, start);
  if (end === -1) throw new PlanRefusedError(`${file}: ${JSON.stringify(open)} is never closed.`);
  return source.slice(start, end);
}

type ReadFile = (path: string) => string;

interface IJsonCatalog {
  actions: Record<string, string>;
  actionGroups: Record<string, string>;
  targetTypes: Record<string, string>;
}

function patchCatalog(source: string, file: string, n: IModuleNames): string {
  const catalog = JSON.parse(source) as IJsonCatalog;
  const domain = n.dir.replaceAll('-', '_');
  const created = `${domain}_${n.accessor}_created`;
  const updated = `${domain}_${n.accessor}_updated`;
  for (const [section, key] of [
    ['actions', created],
    ['actions', updated],
    ['actionGroups', domain],
    ['targetTypes', n.model],
  ] as const) {
    if (typeof catalog[section] !== 'object' || catalog[section][key] !== undefined) {
      throw new PlanRefusedError(
        `${file}: \`${section}.${key}\` already exists or the section is missing.`,
      );
    }
  }
  catalog.actions[created] = `${n.model} created`;
  catalog.actions[updated] = `${n.model} updated`;
  catalog.actionGroups[domain] = n.model;
  catalog.targetTypes[n.model] = n.model;
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function patchCanary(source: string, file: string, n: IModuleNames): string {
  const manifest = JSON.parse(source) as { mutants?: Record<string, unknown> };
  const mutants = manifest.mutants;
  if (typeof mutants !== 'object' || mutants === null || n.accessor in mutants) {
    throw new PlanRefusedError(
      `${file}: no \`mutants\` object, or \`${n.accessor}\` already has one.`,
    );
  }
  const { mustFail } = isolationCaseNames(n);
  const coverage = 'every model the extension isolates has a cross-tenant case';
  const entry = {
    why: `Generated by pnpm new:module with its own isolation spec (${n.dir}.isolation.spec.ts).`,
    mustFail: [
      ...mustFail,
      `${coverage} ${n.accessor} C1 a row of tenant A is invisible to a scoped read under tenant B`,
      `${coverage} ${n.accessor} C2 fails closed when there is no tenant in context`,
    ],
  };
  // Keep the pass-through mutant last, where the manifest reads it.
  const reordered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mutants)) {
    if (key === 'all') reordered[n.accessor] = entry;
    reordered[key] = value;
  }
  if (!(n.accessor in reordered)) reordered[n.accessor] = entry;
  return `${JSON.stringify({ ...manifest, mutants: reordered }, null, 2)}\n`;
}

export interface IPlanInput {
  readonly names: IModuleNames;
  readonly policy: IPolicy;
  readonly purpose: string;
  readonly read: ReadFile;
  readonly exists: (path: string) => boolean;
}

/** Every edit, computed in memory. Throws PlanRefusedError on anything it cannot place safely. */
export function planModule({ names: n, policy, purpose, read, exists }: IPlanInput): PlanEdit[] {
  const moduleDir = `apps/api/src/modules/${n.dir}`;
  const modelFile = `packages/database/prisma/schema/${n.kebab}.prisma`;
  const sharedFile = `packages/shared/src/schemas/${n.dir}.ts`;

  const creates: PlanEdit[] = [
    { kind: 'create', path: modelFile, content: prismaModel(n) },
    { kind: 'create', path: sharedFile, content: sharedSchemas(n) },
    { kind: 'create', path: `${moduleDir}/${n.dir}.module.ts`, content: nestModule(n) },
    { kind: 'create', path: `${moduleDir}/${n.kebab}.repository.ts`, content: repository(n) },
    { kind: 'create', path: `${moduleDir}/${n.kebab}.service.ts`, content: service(n) },
    { kind: 'create', path: `${moduleDir}/${n.kebab}.service.spec.ts`, content: serviceSpec(n) },
    { kind: 'create', path: `${moduleDir}/${n.dir}.router.ts`, content: router(n, policy) },
    { kind: 'create', path: `${moduleDir}/${n.dir}.router.spec.ts`, content: routerSpec(n) },
    { kind: 'create', path: `${moduleDir}/${n.dir}.isolation.spec.ts`, content: isolationSpec(n) },
  ];
  if (exists(moduleDir)) {
    throw new PlanRefusedError(`${moduleDir} already exists; new:module never overwrites.`);
  }
  for (const edit of creates) {
    if (exists(edit.path))
      throw new PlanRefusedError(`${edit.path} already exists; new:module never overwrites.`);
  }

  const patch = (path: string, compute: (source: string) => string): PlanEdit => {
    const before = read(path);
    return { kind: 'patch', path, before, content: compute(before) };
  };

  const patches: PlanEdit[] = [
    patch(PATCHED.tenancySchema, (source) => {
      if (new RegExp(`^model ${n.model} \\{`, 'mu').test(source)) {
        throw new PlanRefusedError(`${PATCHED.tenancySchema}: model ${n.model} already exists.`);
      }
      const at = closingBraceOf(source, 'model Tenant {', PATCHED.tenancySchema);
      return `${source.slice(0, at)}\n  ${n.relation} ${n.model}[]${source.slice(at)}`;
    }),
    patch(PATCHED.scopeRegistry, (source) => {
      const block = blockOf(
        source,
        'export const TENANT_SCOPED_MODELS = {',
        '} as const satisfies',
        PATCHED.scopeRegistry,
      );
      if (new RegExp(`^\\s+${n.accessor}:`, 'mu').test(block)) {
        throw new PlanRefusedError(`\`${n.accessor}\` is already in TENANT_SCOPED_MODELS.`);
      }
      return insertAtAnchor(
        source,
        '} as const satisfies Record<string, readonly string[]>;',
        `  // Generated by \`pnpm new:module\`; proven by ${n.dir}.isolation.spec.ts.\n  ${n.accessor}: ['tenantId'],\n`,
        'before',
        PATCHED.scopeRegistry,
      );
    }),
    patch(PATCHED.lintTenantModels, (source) => {
      const open = 'export const TENANT_MODELS: readonly string[] = [';
      const block = blockOf(source, open, '];', PATCHED.lintTenantModels);
      const models = block
        .slice(open.length)
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
      if (models.some((entry) => !/^'[A-Za-z0-9]+'$/u.test(entry))) {
        throw new PlanRefusedError(
          `${PATCHED.lintTenantModels}: TENANT_MODELS holds something other than plain model names.`,
        );
      }
      if (models.includes(`'${n.accessor}'`)) {
        throw new PlanRefusedError(`\`${n.accessor}\` is already in TENANT_MODELS.`);
      }
      // One entry per line; the prettier pass after the write collapses it when it fits.
      const lines = [...models, `'${n.accessor}'`].map((entry) => `  ${entry},\n`).join('');
      return source.replace(block, () => `${open}\n${lines}`);
    }),
    patch(PATCHED.canaryManifest, (source) => patchCanary(source, PATCHED.canaryManifest, n)),
    patch(PATCHED.coverageSpec, (source) => {
      const withRow = insertAtAnchor(
        source,
        '\n  return {\n    workspace: workspace.id,',
        `\n  const ${n.accessor} = await unscoped.${n.accessor}.create({\n    data: { tenantId, name: \`iso-cov-${n.kebab}-\${uid}\` },\n  });\n`,
        'before',
        PATCHED.coverageSpec,
      );
      const withReturn = insertAtAnchor(
        withRow,
        '  return {\n    workspace: workspace.id,\n',
        `    ${n.accessor}: ${n.accessor}.id,\n`,
        'after',
        PATCHED.coverageSpec,
      );
      return insertAtAnchor(
        withReturn,
        '  await unscoped.user.deleteMany({ where });',
        `  await unscoped.${n.accessor}.deleteMany({ where });\n`,
        'before',
        PATCHED.coverageSpec,
      );
    }),
    patch(PATCHED.appModule, (source) => {
      const imports = [...source.matchAll(/^import .* from '\.\/modules\/.*';$/gmu)];
      const last = imports.at(-1);
      if (last?.index === undefined) {
        throw new PlanRefusedError(
          `${PATCHED.appModule}: no './modules/' import to place the new one after.`,
        );
      }
      const at = last.index + last[0].length;
      const withImport = `${source.slice(0, at)}\nimport { ${n.moduleClass} } from './modules/${n.dir}/${n.dir}.module';${source.slice(at)}`;
      return insertAtAnchor(
        withImport,
        '\n  ],\n  providers: [',
        `\n    ${n.moduleClass},`,
        'before',
        PATCHED.appModule,
      );
    }),
    patch(PATCHED.sharedIndex, (source) => `${source.trimEnd()}\n${sharedIndexExport(n)}`),
    patch(PATCHED.auditActions, (source) =>
      insertAtAnchor(
        source,
        '\n} as const;\n\nexport type AuditAction',
        `\n  // ${n.model} (generated by \`pnpm new:module\`). metadata on update: { fields }.\n  ${n.screaming}_CREATED: '${n.dir}.${n.accessor}.created',\n  ${n.screaming}_UPDATED: '${n.dir}.${n.accessor}.updated',`,
        'before',
        PATCHED.auditActions,
      ),
    ),
    patch(PATCHED.auditCatalogEn, (source) => patchCatalog(source, PATCHED.auditCatalogEn, n)),
    patch(PATCHED.archRegistry, (source) => {
      const block = blockOf(
        source,
        'const API_MODULE_PURPOSES: IPurposeMap = {',
        '\n};',
        PATCHED.archRegistry,
      );
      const key = n.dir.includes('-') ? `'${n.dir}'` : n.dir;
      return source.replace(
        block,
        () => `${block}\n  ${key}: '${purpose.replaceAll("'", "\\'")}',`,
      );
    }),
  ];

  return [...creates, ...patches];
}

/** The migration is computed from the schema, so it is exact; `new-module.ts` supplies it. */
export function migrationEdit(names: IModuleNames, sql: string, stamp: string): PlanEdit {
  if (!/CREATE TABLE/u.test(sql)) {
    throw new PlanRefusedError(
      `prisma migrate diff produced no CREATE TABLE for ${names.model}:\n${sql}`,
    );
  }
  return {
    kind: 'create',
    path: `packages/database/prisma/migrations/${stamp}_add_${names.kebab.replaceAll('-', '_')}/migration.sql`,
    content: sql,
  };
}

/**
 * Write every edit, then run `verify`. Any failure, in a write or in `verify`,
 * restores each patched file to its snapshot and removes each created file and
 * every directory the plan created, so a refused plan leaves the tree as it was.
 */
export function applyPlan(root: string, edits: readonly PlanEdit[], verify: () => void): void {
  const createdDirs: string[] = [];
  const written: PlanEdit[] = [];
  const ensureDir = (dir: string): void => {
    if (existsSync(dir)) return;
    ensureDir(dirname(dir));
    mkdirSync(dir);
    createdDirs.push(dir);
  };

  try {
    for (const edit of edits) {
      const abs = join(root, edit.path);
      if (edit.kind === 'patch' && readFileSync(abs, 'utf8') !== edit.before) {
        throw new PlanRefusedError(
          `${edit.path} changed after the plan was made; nothing was kept.`,
        );
      }
      ensureDir(dirname(abs));
      writeFileSync(abs, edit.content);
      written.push(edit);
    }
    verify();
  } catch (error) {
    for (const edit of written.reverse()) {
      const abs = join(root, edit.path);
      if (edit.kind === 'patch') writeFileSync(abs, edit.before);
      else rmSync(abs, { force: true });
    }
    for (const dir of createdDirs.reverse()) rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

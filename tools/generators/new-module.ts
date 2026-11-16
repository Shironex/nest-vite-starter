/**
 * `pnpm new:module <Model> --policy=<policy> [--plural=<dir>] [--purpose="..."] [--dry-run] [--no-verify]`
 *
 * Scaffolds a tenant-scoped api module that arrives with its isolation spec, its
 * canary mutant, its registry and lint entries and its migration, in one step.
 * `module-plan.ts` computes every edit in memory and refuses anything it cannot
 * place safely; this file supplies the shell steps around it:
 *
 *   1. the migration, from `prisma migrate diff` between the current schema and
 *      the planned one (so the SQL is exactly what Prisma would write, and a
 *      schema that does not validate is refused before the tree is touched);
 *   2. the write, all or nothing;
 *   3. the verification: prettier on the files it wrote (not `prisma format`,
 *      which would reformat schema files it never touched), `db:generate`, and
 *      the api type check. If any of it fails, every file goes back and the
 *      Prisma client is regenerated from the restored schema.
 *
 * What it leaves to you, printed at the end: regenerating the module map, the
 * test inventories that must accept the new cases, and running the isolation
 * lane against a sandbox.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from '../codegen/codegen-utils';
import {
  PATCHED,
  PlanRefusedError,
  applyPlan,
  deriveNames,
  migrationEdit,
  planModule,
  resolvePolicy,
} from './module-plan';
import type { IModuleNames, PlanEdit } from './module-plan';

const SCHEMA_DIR = 'packages/database/prisma/schema';

interface IArgs {
  readonly model: string | undefined;
  readonly policy: string | undefined;
  readonly plural: string | undefined;
  readonly purpose: string | undefined;
  readonly dryRun: boolean;
  readonly verify: boolean;
  readonly workspace: boolean;
}

function parseArgs(argv: readonly string[]): IArgs {
  const value = (flag: string): string | undefined =>
    argv.find((arg) => arg.startsWith(`--${flag}=`))?.slice(flag.length + 3);
  return {
    model: argv.find((arg) => !arg.startsWith('--')),
    policy: value('policy'),
    plural: value('plural'),
    purpose: value('purpose'),
    dryRun: argv.includes('--dry-run'),
    verify: !argv.includes('--no-verify'),
    workspace: argv.includes('--workspace'),
  };
}

/** Run a command at the repo root, streaming its output; throw on a non-zero exit. */
function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(' ')}\` failed (exit ${String(result.status)}).`);
  }
}

/** The migration SQL for the planned schema, diffed against the current one. */
function migrationSql(edits: readonly PlanEdit[]): string {
  const scratch = mkdtempSync(join(tmpdir(), 'new-module-schema-'));
  try {
    const planned = join(scratch, 'schema');
    cpSync(join(repoRoot, SCHEMA_DIR), planned, { recursive: true });
    for (const edit of edits) {
      if (edit.path.startsWith(`${SCHEMA_DIR}/`)) {
        writeFileSync(join(planned, edit.path.slice(SCHEMA_DIR.length + 1)), edit.content);
      }
    }
    const out = join(scratch, 'migration.sql');
    const result = spawnSync(
      'pnpm',
      [
        '--filter',
        '@repo/database',
        'exec',
        'prisma',
        'migrate',
        'diff',
        '--from-schema',
        'prisma/schema',
        '--to-schema',
        planned,
        '--script',
        '--output',
        out,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    if (result.status !== 0 || !existsSync(out)) {
      throw new PlanRefusedError(
        `prisma migrate diff refused the planned schema:\n${result.stdout}\n${result.stderr}`,
      );
    }
    return readFileSync(out, 'utf8');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** `20260922143005`: the migration folder prefix Prisma itself uses. */
function migrationStamp(now: Date): string {
  return now.toISOString().replace(/[-:T]/gu, '').slice(0, 14);
}

function printPlan(names: IModuleNames, edits: readonly PlanEdit[]): void {
  console.log(`\n  new:module ${names.model} -> apps/api/src/modules/${names.dir}\n`);
  for (const edit of edits) {
    console.log(`  ${edit.kind === 'create' ? 'create' : 'patch '}  ${edit.path}`);
  }
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (args.workspace) {
    throw new PlanRefusedError(
      '--workspace is not supported yet: a Workspace-scoped model needs the composite (tenantId, workspaceId) key and a workspaceId in the request context, which the auth middleware does not set. Scope by tenantId and enforce the Workspace in the service.',
    );
  }
  if (args.model === undefined) {
    throw new PlanRefusedError(
      'Usage: pnpm new:module <Model> --policy=<policy> [--plural=<dir>] [--purpose="..."] [--dry-run] [--no-verify]',
    );
  }
  const names = deriveNames(args.model, args.plural);
  const policy = resolvePolicy(args.policy);
  const purpose = args.purpose ?? `Tenant-scoped ${names.model} records, generated by new:module.`;

  const plan = planModule({
    names,
    policy,
    purpose,
    read: (path) => readFileSync(join(repoRoot, path), 'utf8'),
    exists: (path) => existsSync(join(repoRoot, path)),
  });
  const edits = [...plan, migrationEdit(names, migrationSql(plan), migrationStamp(new Date()))];

  printPlan(names, edits);
  if (args.dryRun) {
    console.log(`\n${edits.at(-1)?.content ?? ''}\n  --dry-run: nothing written.\n`);
    return 0;
  }

  const touched = edits.map((edit) => edit.path);
  try {
    applyPlan(repoRoot, edits, () => {
      if (!args.verify) return;
      run('pnpm', [
        'exec',
        'prettier',
        '--write',
        ...touched.filter((path) => !path.endsWith('.prisma') && !path.endsWith('.sql')),
      ]);
      run('pnpm', ['--filter', '@repo/database', 'db:generate']);
      run('pnpm', ['exec', 'turbo', 'check-types', '--filter=@repo/api']);
    });
  } catch (error) {
    console.error(
      '\n  The plan was written and then failed verification; every file has been restored.',
    );
    // The client was generated from the planned schema; bring it back in line.
    spawnSync('pnpm', ['--filter', '@repo/database', 'db:generate'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    throw error;
  }

  console.log(`
  Done. Still yours to do:
    pnpm generate:arch-map                     the module map names the new module
    pnpm sandbox:up && export DATABASE_URL="$(pnpm sandbox:inspect --lane-url=isolation | tail -n 1)"
    pnpm --filter @repo/api test:integration   ${names.dir}.isolation.spec.ts runs in the lane
    pnpm verify:inventory --accept             the new cases join the committed inventories
  The canary mutant for \`${names.accessor}\` is in ${PATCHED.canaryManifest}.
`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(
    `\n  new:module refused: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

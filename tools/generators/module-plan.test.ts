import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkIsolationCanaryCoverage } from '../lint-meta/rules/config/isolation-canary-coverage';
import {
  PATCHED,
  PlanRefusedError,
  applyPlan,
  deriveNames,
  insertAtAnchor,
  migrationEdit,
  planModule,
  resolvePolicy,
} from './module-plan';
import type { PlanEdit } from './module-plan';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/*
 * A temp tree holding the REAL files the plan patches, copied from this
 * checkout. A plan that passes here fits the tree as it is today; a refactor
 * that moves one of the anchors turns this suite red instead of turning the
 * next `pnpm new:module` into a refusal nobody saw coming.
 */
function realTree(): {
  root: string;
  read: (path: string) => string;
  exists: (path: string) => boolean;
} {
  const root = mkdtempSync(join(tmpdir(), 'new-module-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of Object.values(PATCHED)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(REPO, path), join(root, path));
  }
  return {
    root,
    read: (path) => readFileSync(join(root, path), 'utf8'),
    exists: (path) => existsSync(join(root, path)),
  };
}

const plan = (
  tree: ReturnType<typeof realTree>,
  model = 'Invoice',
  policy = 'organization-read-admin-write',
) =>
  planModule({
    names: deriveNames(model),
    policy: resolvePolicy(policy),
    purpose: "Invoices of a workspace's books.",
    read: tree.read,
    exists: tree.exists,
  });

const edit = (edits: readonly PlanEdit[], path: string): PlanEdit => {
  const found = edits.find((candidate) => candidate.path === path);
  assert.ok(found, `the plan has no edit for ${path}`);
  return found;
};

/** Every file of the tree, for a byte-for-byte before/after comparison. */
function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(
    Object.values(PATCHED).map((path) => [path, readFileSync(join(root, path), 'utf8')]),
  );
}

describe('deriveNames', () => {
  it('derives every name from one PascalCase model', () => {
    assert.deepEqual(deriveNames('Invoice'), {
      model: 'Invoice',
      accessor: 'invoice',
      kebab: 'invoice',
      dir: 'invoices',
      alias: 'invoices',
      screaming: 'INVOICE',
      relation: 'invoices',
      routerClass: 'InvoicesRouter',
      moduleClass: 'InvoicesModule',
    });
  });

  it('takes an explicit plural and camel-cases a multi-word one', () => {
    const names = deriveNames('LineItem', 'line-items');
    assert.equal(names.dir, 'line-items');
    assert.equal(names.alias, 'lineItems');
    assert.equal(names.routerClass, 'LineItemsRouter');
    assert.equal(names.screaming, 'LINE_ITEM');
  });

  it('refuses a name that is not PascalCase, and a plural equal to the singular', () => {
    assert.throws(() => deriveNames('invoice'), PlanRefusedError);
    assert.throws(() => deriveNames('Sheep', 'sheep'), PlanRefusedError);
  });
});

describe('resolvePolicy', () => {
  it('refuses an unknown or missing policy instead of guessing one', () => {
    assert.throws(
      () => resolvePolicy('admin-only'),
      /must be one of: organization-read-write, organization-read-admin-write/u,
    );
    assert.throws(() => resolvePolicy(undefined), /--policy is required/u);
  });
});

describe('planModule on the real tree', () => {
  it('creates the module, its specs, the model and the wire schemas', () => {
    const creates = plan(realTree())
      .filter((candidate) => candidate.kind === 'create')
      .map((candidate) => candidate.path);
    assert.deepEqual(creates, [
      'packages/database/prisma/schema/invoice.prisma',
      'packages/shared/src/schemas/invoices.ts',
      'apps/api/src/modules/invoices/invoices.module.ts',
      'apps/api/src/modules/invoices/invoice.repository.ts',
      'apps/api/src/modules/invoices/invoice.service.ts',
      'apps/api/src/modules/invoices/invoice.service.spec.ts',
      'apps/api/src/modules/invoices/invoices.router.ts',
      'apps/api/src/modules/invoices/invoices.router.spec.ts',
      'apps/api/src/modules/invoices/invoices.isolation.spec.ts',
    ]);
  });

  it('registers the model with the extension, the lint config and the coverage spec', () => {
    const edits = plan(realTree());
    assert.match(
      edit(edits, PATCHED.scopeRegistry).content,
      /\n {2}invoice: \['tenantId'\],\n\} as const satisfies/u,
    );
    assert.match(edit(edits, PATCHED.lintTenantModels).content, /\n {2}'invoice',\n\];/u);
    const coverage = edit(edits, PATCHED.coverageSpec).content;
    assert.match(coverage, /const invoice = await unscoped\.invoice\.create\(/u);
    assert.match(coverage, /return \{\n {4}workspace: workspace\.id,\n {4}invoice: invoice\.id,/u);
    assert.match(
      coverage,
      /await unscoped\.invoice\.deleteMany\(\{ where \}\);\n {2}await unscoped\.user\.deleteMany/u,
    );
    assert.match(edit(edits, PATCHED.tenancySchema).content, /\n {2}invoices Invoice\[\]\n\}/u);
  });

  it('gives the model a canary mutant naming the generated cases, with `all` still last', () => {
    const manifest = JSON.parse(edit(plan(realTree()), PATCHED.canaryManifest).content) as {
      mutants: Record<string, { mustFail: string[] }>;
    };
    const keys = Object.keys(manifest.mutants);
    assert.equal(keys.at(-1), 'all');
    assert.equal(keys.at(-2), 'invoice');
    assert.ok(
      manifest.mutants.invoice?.mustFail.includes(
        'invoices tenant isolation (generated) I1 a list under tenant B never returns a row of tenant A',
      ),
    );
  });

  it('names every new audit action and domain in the web strings table', () => {
    const edits = plan(realTree());
    assert.match(
      edit(edits, PATCHED.auditActions).content,
      /INVOICE_CREATED: 'invoices\.invoice\.created'/u,
    );
    const strings = edit(edits, PATCHED.auditStrings).content;
    assert.match(strings, /^ {4}invoices_invoice_created: 'Invoice created',$/mu);
    assert.match(strings, /^ {4}invoices_invoice_updated: 'Invoice updated',$/mu);
    assert.match(strings, /^ {4}invoices: 'Invoice',$/mu);
    assert.match(strings, /^ {4}Invoice: 'Invoice',$/mu);
  });

  it('maps the policy onto the middleware set, never a guess', () => {
    const admin = edit(
      plan(realTree()),
      'apps/api/src/modules/invoices/invoices.router.ts',
    ).content;
    assert.match(admin, /@UseMiddlewares\(AuthMiddleware, AdminMiddleware\)/u);
    const open = edit(
      plan(realTree(), 'Invoice', 'organization-read-write'),
      'apps/api/src/modules/invoices/invoices.router.ts',
    ).content;
    assert.doesNotMatch(open, /AdminMiddleware/u);
    assert.match(open, /@UseMiddlewares\(AuthMiddleware\)/u);
  });

  it('refuses a model the registry already isolates', () => {
    assert.throws(
      () => plan(realTree(), 'Workspace'),
      /`workspace` is already in TENANT_SCOPED_MODELS|model Workspace already exists/u,
    );
  });

  it('refuses a missing or repeated anchor, before anything is written', () => {
    const tree = realTree();
    const registry = join(tree.root, PATCHED.scopeRegistry);
    writeFileSync(
      registry,
      readFileSync(registry, 'utf8').replace(
        '} as const satisfies Record<string, readonly string[]>;',
        '};',
      ),
    );
    assert.throws(() => plan(tree), /TENANT_SCOPED_MODELS = \{|is never closed|anchor/u);
    assert.throws(
      () => insertAtAnchor('a X b X', 'X', '!', 'before', 'f'),
      /occurs more than once/u,
    );
  });

  it('refuses a module directory that already exists', () => {
    const tree = realTree();
    mkdirSync(join(tree.root, 'apps/api/src/modules/invoices'), { recursive: true });
    assert.throws(() => plan(tree), /already exists; new:module never overwrites/u);
  });
});

describe('applyPlan', () => {
  it('leaves the tree byte-identical when verification fails', () => {
    const tree = realTree();
    const before = snapshot(tree.root);
    const edits = plan(tree);
    assert.throws(
      () =>
        applyPlan(tree.root, edits, () => {
          throw new Error('type check failed');
        }),
      /type check failed/u,
    );
    assert.deepEqual(snapshot(tree.root), before);
    assert.equal(existsSync(join(tree.root, 'apps/api/src/modules/invoices')), false);
    assert.equal(existsSync(join(tree.root, 'packages/shared/src/schemas/invoices.ts')), false);
    assert.equal(
      existsSync(join(tree.root, 'packages/database/prisma/schema/invoice.prisma')),
      false,
    );
  });

  it('refuses a file that changed after the plan was made, and restores what it wrote', () => {
    const tree = realTree();
    const edits = plan(tree);
    const lint = join(tree.root, PATCHED.lintTenantModels);
    writeFileSync(lint, `${readFileSync(lint, 'utf8')}\n// edited meanwhile\n`);
    const changed = snapshot(tree.root);
    assert.throws(
      () => applyPlan(tree.root, edits, () => undefined),
      /changed after the plan was made/u,
    );
    assert.deepEqual(snapshot(tree.root), changed);
  });

  it('end to end: the written tree satisfies isolation-canary-coverage for the new model', () => {
    const tree = realTree();
    const names = deriveNames('Invoice');
    const edits = [
      ...plan(tree),
      migrationEdit(names, 'CREATE TABLE "Invoice" ("id" TEXT NOT NULL);\n', '20260922000000'),
    ];
    applyPlan(tree.root, edits, () => undefined);

    assert.ok(
      existsSync(join(tree.root, 'apps/api/src/modules/invoices/invoices.isolation.spec.ts')),
    );
    assert.ok(
      existsSync(
        join(
          tree.root,
          'packages/database/prisma/migrations/20260922000000_add_invoice/migration.sql',
        ),
      ),
    );
    assert.deepEqual(checkIsolationCanaryCoverage(tree.root), []);

    // And the rule does see the new model: without its mutant the tree is red.
    const manifestPath = join(tree.root, PATCHED.canaryManifest);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      mutants: Record<string, unknown>;
    };
    delete manifest.mutants.invoice;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.match(
      checkIsolationCanaryCoverage(tree.root)[0]?.message ?? '',
      /`invoice` is isolated by the tenant-scope extension/u,
    );
  });

  it('refuses a migration that creates no table', () => {
    assert.throws(
      () => migrationEdit(deriveNames('Invoice'), '-- empty\n', '20260922000000'),
      PlanRefusedError,
    );
  });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { IMetaCtx } from '@noctcore/harness';

import { adoptHarnessRule, adoptLocalRule, assertEveryRuleBlocks } from './harness';
import type { IHarnessMetaRule } from './harness';
import { createFixture } from './test-support';
import type { IMetaContext, IMetaRule, IViolation } from './types';

const LINT_META_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(LINT_META_DIR, '..', '..');

/** What the harness hands a rule: the portable context and nothing else. */
function harnessContext(root: string): IMetaCtx {
  return {
    root,
    read: () => null,
    exists: () => false,
    glob: () => [],
    exec: () => ({ code: 0, stdout: '', stderr: '' }),
  };
}

/** A local check that needs the pre-collected source list the harness does not provide. */
function findFixme(ctx: IMetaContext): IViolation[] {
  return ctx.sourceFiles
    .filter((file) => (ctx.read(file.slice(ctx.root.length + 1)) ?? '').includes('FIXME'))
    .map((file) => ({ file, rule: 'source-list-fixture', message: 'mentions FIXME' }));
}

const FIXTURE_RULE = {
  id: 'source-list-fixture',
  category: 'source-text',
  description: 'No source file may mention FIXME.',
} as const;

function sourceListRule(overrides: Partial<IMetaRule> = {}): IMetaRule {
  return { ...FIXTURE_RULE, ciCritical: true, run: findFixme, ...overrides };
}

/** The same rule with no `ciCritical` at all, as a rule that lost the flag would be. */
function unflaggedRule(): IMetaRule {
  return { ...FIXTURE_RULE, run: findFixme };
}

/** A rule written against `@noctcore/harness` and nothing else. */
function portableRule(overrides: Partial<IHarnessMetaRule> = {}): IHarnessMetaRule {
  return {
    id: 'portable-fixture',
    category: 'config',
    description: 'Every package.json must declare a name.',
    run: (ctx) =>
      ctx
        .glob('packages/*/package.json')
        .filter((file) => !(ctx.read(file) ?? '').includes('"name"'))
        .map((file) => ({ file, rule: 'portable-fixture', message: 'package.json has no name.' })),
    ...overrides,
  };
}

describe('adoptLocalRule', () => {
  it('builds the local context from the harness root, so a rule reading sourceFiles still sees the tree', () => {
    const fixture = createFixture({
      'apps/api/src/clean.ts': 'export const a = 1;\n',
      'apps/api/src/dirty.ts': '// FIXME\n',
    });

    const violations = adoptLocalRule(sourceListRule()).run?.(harnessContext(fixture.root));

    assert.deepEqual(
      violations?.map((violation) => violation.file),
      [fixture.path('apps/api/src/dirty.ts')],
    );
  });

  it('builds that context once per harness context, not once per rule', () => {
    const fixture = createFixture();
    const seen: IMetaContext[] = [];
    const spy: IMetaRule = {
      ...sourceListRule(),
      run: (ctx) => {
        seen.push(ctx);
        return [];
      },
    };
    const ctx = harnessContext(fixture.root);

    adoptLocalRule(spy).run?.(ctx);
    adoptLocalRule({ ...spy, id: 'second' }).run?.(ctx);
    adoptLocalRule(spy).run?.(harnessContext(fixture.root));

    assert.equal(seen[0], seen[1]);
    assert.notEqual(seen[1], seen[2]);
  });

  it('hands a context that is already local through untouched', () => {
    const local = createFixture().context();
    let seen: IMetaContext | undefined;

    adoptLocalRule({
      ...sourceListRule(),
      run: (ctx) => {
        seen = ctx;
        return [];
      },
    }).run?.(local);

    assert.equal(seen, local);
  });

  it('carries the async pass over, with the local context', async () => {
    const fixture = createFixture();
    const adopted = adoptLocalRule({
      ...FIXTURE_RULE,
      ciCritical: true,
      runAsync: (ctx) =>
        Promise.resolve([{ file: String(ctx.sourceFiles.length), rule: 'r', message: 'm' }]),
    });

    assert.equal(adopted.run, undefined);
    assert.deepEqual(await adopted.runAsync?.(harnessContext(fixture.root)), [
      { file: '0', rule: 'r', message: 'm' },
    ]);
  });

  it('carries ciCritical as declared instead of repairing it, so the registry guard can see it', () => {
    assert.equal(adoptLocalRule(sourceListRule({ ciCritical: false })).ciCritical, false);
    assert.equal(adoptLocalRule(unflaggedRule()).ciCritical, undefined);
  });
});

describe('adoptHarnessRule', () => {
  it('runs an upstream rule on the harness context and reports its violations', () => {
    const fixture = createFixture({
      'packages/named/package.json': '{ "name": "@repo/named" }',
      'packages/anonymous/package.json': '{ "version": "0.0.0" }',
    });

    const violations = adoptHarnessRule(portableRule()).run?.(fixture.context());

    assert.deepEqual(
      violations?.map((violation) => violation.file),
      ['packages/anonymous/package.json'],
    );
  });

  it('marks an adopted rule ci-critical, whatever the upstream rule said', () => {
    assert.equal(adoptHarnessRule(portableRule({ ciCritical: false })).ciCritical, true);
  });

  it('refuses a ratcheting rule', () => {
    assert.throws(
      () => adoptHarnessRule(portableRule({ baseline: () => ({ offenders: 3 }) })),
      /declares a baseline/u,
    );
  });
});

describe('assertEveryRuleBlocks', () => {
  it('passes a registry of strict, critical, uniquely named rules through', () => {
    const rules = [adoptHarnessRule(portableRule())];

    assert.equal(assertEveryRuleBlocks(rules), rules);
  });

  it('refuses a rule that is not ciCritical, naming it', () => {
    assert.throws(
      () => assertEveryRuleBlocks([adoptLocalRule(unflaggedRule())]),
      /"source-list-fixture" is not ciCritical/u,
    );
  });

  it('refuses a ratcheting rule and a repeated id', () => {
    assert.throws(
      () => assertEveryRuleBlocks([{ ...portableRule(), ciCritical: true, baseline: () => ({}) }]),
      /declares a baseline/u,
    );
    assert.throws(
      () =>
        assertEveryRuleBlocks([adoptHarnessRule(portableRule()), adoptHarnessRule(portableRule())]),
      /registered twice/u,
    );
  });
});

/*
 * The failure modes above, through the real `harness lint-meta` CLI the root
 * `lint:meta` script runs, on a real fixture tree: a unit test of the guard
 * proves nothing about what the harness does with a guard that throws.
 */
describe('harness lint-meta on a registry built with this seam', () => {
  const harnessCli = join(REPO_ROOT, 'node_modules', '@noctcore', 'harness', 'dist', 'cli.js');
  const tsx = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  const seam = join(LINT_META_DIR, 'harness.ts');

  function registry(ruleSource: string): string {
    return [
      `import { adoptLocalRule, assertEveryRuleBlocks } from ${JSON.stringify(seam)};`,
      'export const META_RULES = assertEveryRuleBlocks([',
      `  adoptLocalRule({ id: 'fixme', category: 'source-text', description: 'No FIXME.', ${ruleSource}`,
      "    run: (ctx) => ctx.sourceFiles.filter((f) => (ctx.read(f.slice(ctx.root.length + 1)) ?? '').includes('FIXME'))",
      "      .map((f) => ({ file: f.slice(ctx.root.length + 1), rule: 'fixme', message: 'mentions FIXME' })) }),",
      ']);',
      '',
    ].join('\n');
  }

  function lintMeta(files: Readonly<Record<string, string>>): { code: number; output: string } {
    const fixture = createFixture(files);
    const result = spawnSync(
      tsx,
      [harnessCli, 'lint-meta', '--dir', fixture.root, '--registry', 'registry.ts'],
      { encoding: 'utf8' },
    );

    return { code: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
  }

  it('exits 0 on a clean tree', () => {
    const run = lintMeta({
      'registry.ts': registry('ciCritical: true,'),
      'apps/api/src/a.ts': 'export {};\n',
    });

    assert.equal(run.code, 0, run.output);
    assert.match(run.output, /no violations/u);
  });

  it('exits 1 and names the file when a local rule reports', () => {
    const run = lintMeta({
      'registry.ts': registry('ciCritical: true,'),
      'apps/api/src/a.ts': '// FIXME\n',
    });

    assert.equal(run.code, 1, run.output);
    assert.match(run.output, /\[ERROR\] fixme \(apps\/api\/src\/a\.ts\): mentions FIXME/u);
  });

  it('exits 1 before running anything when a rule is not ciCritical, instead of printing [info]', () => {
    const run = lintMeta({
      'registry.ts': registry(''),
      'apps/api/src/a.ts': '// FIXME\n',
    });

    assert.equal(run.code, 1, run.output);
    assert.match(run.output, /Failed to load the lint-meta registry/u);
    assert.match(run.output, /"fixme" is not ciCritical/u);
    assert.doesNotMatch(run.output, /lint-meta: running/u);
    assert.doesNotMatch(run.output, /^\[info\] fixme/mu);
  });
});

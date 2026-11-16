import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import type { IParseContext } from './baseline-sources';
import {
  collectTestFindings,
  packageOfLabel,
  parseEslintOutput,
  parseLintMetaOutput,
  parseTscOutput,
  parseTurboFailures,
  splitTurboLines,
} from './baseline-sources';
import { INVENTORY_SUITES } from './inventory-suites';
import { tempDir } from './test-support';

const ROOT = '/work/starter';

const CONTEXT: IParseContext = {
  root: ROOT,
  packageDirs: new Map([
    ['@repo/api', 'apps/api'],
    ['@repo/web', 'apps/web'],
    ['@repo/docs', 'apps/docs'],
    ['nest-vite-saas-starter', ''],
  ]),
  exitCode: 1,
};

function green(context: IParseContext = CONTEXT): IParseContext {
  return { ...context, exitCode: 0 };
}

describe('turbo prefixes', () => {
  it('splits a prefixed line back into its task and its text', () => {
    const [first, second, third] = splitTurboLines(
      [
        '@repo/api:lint: eslint .',
        'nest-vite-saas-starter:check-types:tools: src/x.ts(1,1): error TS1: no',
        'Failed: x',
      ].join('\n'),
    );

    assert.deepEqual(first, { label: '@repo/api:lint', text: 'eslint .' });
    assert.equal(second?.label, 'nest-vite-saas-starter:check-types:tools');
    assert.equal(second?.text, 'src/x.ts(1,1): error TS1: no');
    assert.equal(third?.label, null);
  });

  it('reads the package off a task label', () => {
    assert.equal(packageOfLabel('@repo/api:lint'), '@repo/api');
    assert.equal(packageOfLabel(null), null);
  });

  it('reads the tasks turbo says failed', () => {
    assert.deepEqual(parseTurboFailures('Failed:    @repo/docs#check-types, @repo/api#lint'), [
      '@repo/docs#check-types',
      '@repo/api#lint',
    ]);
  });
});

describe('ESLint output', () => {
  const output = [
    `@repo/api:lint: ${ROOT}/apps/api/src/old.ts`,
    '@repo/api:lint:   12:3  error  Unexpected console statement  no-console',
    '@repo/api:lint:   80:1  error  Unexpected console statement  no-console',
    '@repo/api:lint: ',
    '@repo/api:lint: ✖ 2 problems (2 errors, 0 warnings)',
  ].join('\n');

  it('reads a finding per problem, repo-relative and without line or column', () => {
    const parsed = parseEslintOutput(output, CONTEXT);

    assert.equal(parsed.blocked, null);
    assert.equal(parsed.findings.length, 2);
    assert.deepEqual(parsed.findings[0], {
      kind: 'eslint',
      file: 'apps/api/src/old.ts',
      rule: 'no-console',
      message: 'Unexpected console statement',
    });
    // Two problems, one key, counted twice: same file, same rule, same message.
    assert.deepEqual(parsed.findings[0], parsed.findings[1]);
  });

  it('keeps a problem that has no rule id, such as a parse error', () => {
    const parsed = parseEslintOutput(
      [
        `@repo/web:lint: ${ROOT}/apps/web/src/broken.tsx`,
        '@repo/web:lint:   1:1  error  Parsing error: Unexpected token',
        '@repo/web:lint: ✖ 1 problem (1 error, 0 warnings)',
      ].join('\n'),
      CONTEXT,
    );

    assert.equal(parsed.findings[0]?.rule, '');
    assert.equal(parsed.findings[0]?.message, 'Parsing error: Unexpected token');
  });

  // ESLint counts its own problems. A parser that read fewer has to say so
  // rather than hand back a baseline that is quietly too small.
  it("blocks when its own count disagrees with ESLint's", () => {
    const parsed = parseEslintOutput(
      [
        `@repo/api:lint: ${ROOT}/apps/api/src/old.ts`,
        '@repo/api:lint: ✖ 3 problems (3 errors, 0 warnings)',
      ].join('\n'),
      CONTEXT,
    );

    assert.match(parsed.blocked ?? '', /reported 3 problem\(s\), this parser read 0/u);
  });

  it('blocks a failed turbo task no finding explains', () => {
    const parsed = parseEslintOutput('Failed:    @repo/docs#lint', CONTEXT);

    assert.match(parsed.blocked ?? '', /@repo\/docs#lint failed, and no lint finding explains it/u);
  });

  it('accepts a clean run', () => {
    assert.deepEqual(parseEslintOutput('@repo/api:lint: > eslint .', green()), {
      findings: [],
      blocked: null,
    });
  });
});

describe('tsc output', () => {
  it('keys on file, code and message, dropping the line and column', () => {
    const parsed = parseTscOutput(
      '@repo/api:check-types: src/modules/x.service.ts(12,3): error TS2345: Argument of type A is not assignable',
      CONTEXT,
    );

    assert.deepEqual(parsed.findings[0], {
      kind: 'tsc',
      file: 'apps/api/src/modules/x.service.ts',
      rule: 'TS2345',
      message: 'Argument of type A is not assignable',
    });
  });

  it('files a diagnostic with no file of its own under (global)', () => {
    const parsed = parseTscOutput('error TS18003: No inputs were found in config file', CONTEXT);

    assert.equal(parsed.findings[0]?.file, '(global)');
    assert.equal(parsed.findings[0]?.rule, 'TS18003');
  });

  it('reads a root task, whose paths are already repo-relative', () => {
    const parsed = parseTscOutput(
      'nest-vite-saas-starter:check-types:tools: tools/verify/baseline.ts(9,5): error TS2322: Type X is not assignable',
      CONTEXT,
    );

    assert.equal(parsed.findings[0]?.file, 'tools/verify/baseline.ts');
  });

  // apps/docs type-checks with `astro check`, whose format nothing here reads.
  // Blocking is the point: a gate that skips what it cannot parse grades a lane
  // green on exactly the failure nobody was watching.
  it('blocks a failing task whose format it cannot read', () => {
    const parsed = parseTscOutput(
      [
        '@repo/docs:check-types: src/pages/index.astro:3:1 - error ts(2345): nope',
        'Failed:    @repo/docs#check-types',
      ].join('\n'),
      CONTEXT,
    );

    assert.match(parsed.blocked ?? '', /@repo\/docs#check-types failed/u);
  });

  it('blocks a non-zero exit that parsed as nothing at all', () => {
    assert.match(parseTscOutput('something went wrong', CONTEXT).blocked ?? '', /exited 1/u);
  });
});

describe('lint:meta output', () => {
  const output = [
    'lint-meta: running 2 rules from /work/starter/tools/lint-meta/registry.ts',
    '\u2192 tenant-scoped-tables-require-where',
    '\u2192 no-audit-write-in-transaction',
    '[ERROR] tenant-scoped-tables-require-where (apps/api/src/a.ts): read without a where',
    '[ERROR] no-audit-write-in-transaction (/work/starter/apps/api/src/b.ts): audit inside a transaction (see docs): here',
    '',
  ].join('\n');

  it('reads file, rule and message, repo-relative whichever way the rule wrote the file', () => {
    const parsed = parseLintMetaOutput(output, CONTEXT);

    assert.equal(parsed.blocked, null);
    assert.deepEqual(parsed.findings, [
      {
        kind: 'lint-meta',
        file: 'apps/api/src/a.ts',
        rule: 'tenant-scoped-tables-require-where',
        message: 'read without a where',
      },
      {
        kind: 'lint-meta',
        file: 'apps/api/src/b.ts',
        rule: 'no-audit-write-in-transaction',
        message: 'audit inside a transaction (see docs): here',
      },
    ]);
  });

  it('blocks on a rule that threw, which checked nothing', () => {
    const parsed = parseLintMetaOutput(
      '[ERROR] forbidden-text: rule threw \u2014 directive.test is not a function\n',
      CONTEXT,
    );

    assert.match(parsed.blocked ?? '', /threw: forbidden-text \(directive\.test/u);
  });

  it('blocks on a tagged line it cannot read, which is a format change', () => {
    const parsed = parseLintMetaOutput('[ERROR] some new shape\n', CONTEXT);

    assert.match(parsed.blocked ?? '', /cannot read, first: \[ERROR\] some new shape/u);
  });

  it('blocks a failure that printed no violation, such as a registry that would not load', () => {
    assert.match(
      parseLintMetaOutput('Failed to load the lint-meta registry at /repo/x.ts: boom', CONTEXT)
        .blocked ?? '',
      /without printing a violation/u,
    );
  });

  it('accepts a clean run', () => {
    assert.deepEqual(parseLintMetaOutput('lint-meta: no violations', green()), {
      findings: [],
      blocked: null,
    });
  });
});

describe('test findings', () => {
  function report(status: 'passed' | 'failure' | 'skipped'): string {
    const body =
      status === 'passed' ? '' : status === 'failure' ? '<failure>boom</failure>' : '<skipped/>';
    return [
      '<?xml version="1.0"?>',
      '<testsuites>',
      '<testsuite name="x.spec.ts" tests="1" failures="0">',
      `<testcase classname="x" name="a thing works" file="src/x.spec.ts">${body}</testcase>`,
      '</testsuite>',
      '</testsuites>',
    ].join('\n');
  }

  function withReports(status: 'passed' | 'failure' | 'skipped', skip?: string): string {
    const root = tempDir('baseline-tests');
    for (const suite of INVENTORY_SUITES) {
      if (!suite.required || suite.id === skip) {
        continue;
      }
      const file = join(root, suite.report);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, report(status), 'utf8');
    }
    return root;
  }

  it('keys only the cases that did not pass', () => {
    assert.deepEqual(collectTestFindings(withReports('passed')), { findings: [], blocked: null });
  });

  it('keys a failing case on its file, its status and its full name', () => {
    const parsed = collectTestFindings(withReports('failure'));

    assert.equal(parsed.blocked, null);
    assert.equal(parsed.findings[0]?.kind, 'test');
    assert.equal(parsed.findings[0]?.rule, 'failed');
    assert.equal(parsed.findings[0]?.message, 'a thing works');
    assert.match(parsed.findings[0]?.file ?? '', /src\/x\.spec\.ts$/u);
  });

  it('keys a skipped case too: a case that did not run is not evidence', () => {
    assert.equal(collectTestFindings(withReports('skipped')).findings[0]?.rule, 'skipped');
  });

  it('blocks when a required suite left no report', () => {
    const parsed = collectTestFindings(withReports('passed', 'web'));

    assert.match(parsed.blocked ?? '', /no test report for web/u);
  });
});

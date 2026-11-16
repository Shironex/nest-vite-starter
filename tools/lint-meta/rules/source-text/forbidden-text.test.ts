import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import {
  codeOnlySource,
  BULL_REGISTER_QUEUE_MESSAGE,
  INLINE_DISABLE_MESSAGE,
  isGenerated,
  noInlineLintDisableRule,
  noTsIgnoreRule,
  queueRegistrationThroughHelperRule,
  TS_SUPPRESSION_MESSAGE,
} from './forbidden-text';

describe('no-inline-lint-disable', () => {
  it('reports each inline eslint-disable form', () => {
    const fixture = createFixture({
      'apps/api/src/next-line.ts': '// eslint-disable-next-line no-console\nconsole.log(1);\n',
      'apps/api/src/block.ts': '/* eslint-disable */\nexport const a = 1;\n',
      'apps/api/src/same-line.ts': 'console.log(1); // eslint-disable-line no-console\n',
    });

    const violations = runSync(noInlineLintDisableRule, fixture.context());

    assert.equal(violations.length, 3);
    for (const violation of violations) {
      assert.equal(violation.rule, 'no-inline-lint-disable');
      assert.equal(violation.message, INLINE_DISABLE_MESSAGE);
    }
    assert.deepEqual(violations.map((violation) => violation.file.split('/').pop()).sort(), [
      'block.ts',
      'next-line.ts',
      'same-line.ts',
    ]);
  });

  it('passes clean source, including a file that only mentions eslint', () => {
    const fixture = createFixture({
      'apps/api/src/clean.ts': "export const note = 'run eslint before you push';\n",
    });

    assert.deepEqual(runSync(noInlineLintDisableRule, fixture.context()), []);
  });

  it('skips generated output, which legitimately carries blanket suppressions', () => {
    const banner = '/* eslint-disable */\nexport const generated = true;\n';
    const fixture = createFixture({
      'apps/web/src/routeTree.gen.ts': banner,
      'apps/api/src/@generated/server.ts': banner,
      'packages/database/src/generated/client.ts': banner,
    });

    assert.deepEqual(runSync(noInlineLintDisableRule, fixture.context()), []);
  });

  it('only scans src, test and tests of a workspace', () => {
    const fixture = createFixture({
      'apps/api/scripts/tool.ts': '// eslint-disable-next-line no-console\n',
      'apps/api/test/spec.ts': '// eslint-disable-next-line no-console\n',
    });

    const violations = runSync(noInlineLintDisableRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.file ?? '', /apps\/api\/test\/spec\.ts$/u);
  });

  it('reports a block directive whose first line carries it', () => {
    const fixture = createFixture({
      'apps/api/src/multi.ts': '/*\n eslint-disable no-console\n*/\nconsole.log(1);\n',
    });

    assert.equal(runSync(noInlineLintDisableRule, fixture.context()).length, 1);
  });

  it('passes text that names a directive without being one', () => {
    const fixture = createFixture({
      // Every shape lint-meta's own source carries: a regex pattern, a message
      // string, a rule test's fixture, and prose inside a doc comment.
      'apps/api/src/pattern.ts': 'export const P = /eslint-disable(-next-line)?/u;\n',
      'apps/api/src/message.ts': "export const M = 'Inline eslint-disable is not allowed.';\n",
      'apps/api/src/fixture.ts':
        "const bad = '// eslint-disable-next-line no-console';\nexport { bad };\n",
      'apps/api/src/prose.ts':
        '/** Rejects `// eslint-disable` directives in source. */\nexport const a = 1;\n',
    });

    assert.deepEqual(runSync(noInlineLintDisableRule, fixture.context()), []);
  });
});

describe('no-ts-ignore', () => {
  it('reports both @ts-ignore and @ts-expect-error', () => {
    const fixture = createFixture({
      'apps/web/src/ignore.ts': '// @ts-ignore\nconst a: number = "x";\n',
      'apps/web/src/expect.tsx': '// @ts-expect-error legacy\nconst b: number = "x";\n',
    });

    const violations = runSync(noTsIgnoreRule, fixture.context());

    assert.equal(violations.length, 2);
    for (const violation of violations) {
      assert.equal(violation.rule, 'no-ts-ignore');
      assert.equal(violation.message, TS_SUPPRESSION_MESSAGE);
    }
  });

  it('passes source with no suppression comment', () => {
    const fixture = createFixture({
      'apps/web/src/clean.ts': 'export const value: number = 1;\n',
    });

    assert.deepEqual(runSync(noTsIgnoreRule, fixture.context()), []);
  });

  it('skips generated output', () => {
    const fixture = createFixture({
      'apps/web/src/routeTree.gen.ts': '// @ts-nocheck\n// @ts-ignore\nexport const x = 1;\n',
    });

    assert.deepEqual(runSync(noTsIgnoreRule, fixture.context()), []);
  });

  it('passes a suppression named in prose, in a string or in a pattern', () => {
    const fixture = createFixture({
      'apps/web/src/pattern.ts': 'export const P = /@ts-(ignore|expect-error)/u;\n',
      'apps/web/src/fixture.ts': "const bad = '// @ts-ignore';\nexport { bad };\n",
      'apps/web/src/prose.tsx':
        '/** No `@ts-ignore` / `@ts-expect-error` suppressions. */\nexport const a = 1;\n',
    });

    assert.deepEqual(runSync(noTsIgnoreRule, fixture.context()), []);
  });

  it('still reports a directive that trails real code on the same line', () => {
    const fixture = createFixture({
      'apps/web/src/trailing.ts': 'const a: number = load(); // @ts-expect-error legacy\n',
    });

    assert.equal(runSync(noTsIgnoreRule, fixture.context()).length, 1);
  });
});

describe('queue-registration-through-helper', () => {
  const HELPER = 'apps/api/src/common/queue/register-queue.ts';

  it('reports a module that calls BullModule.registerQueue directly', () => {
    const fixture = createFixture({
      'apps/api/src/modules/mail/mail.module.ts':
        "import { BullModule } from '@nestjs/bullmq';\n" +
        'export const q = BullModule.registerQueue({ name: MAIL });\n',
    });

    const violations = runSync(queueRegistrationThroughHelperRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'queue-registration-through-helper');
    assert.equal(violations[0]?.message, BULL_REGISTER_QUEUE_MESSAGE);
  });

  it('exempts the helper folder, which is where the real API is called', () => {
    const fixture = createFixture({
      [HELPER]:
        "import { BullModule } from '@nestjs/bullmq';\n" +
        'export const register = (name) => BullModule.registerQueue({ name });\n',
    });

    assert.deepEqual(runSync(queueRegistrationThroughHelperRule, fixture.context()), []);
  });

  it('passes a module that registers through the helper, and prose that names the API', () => {
    const fixture = createFixture({
      'apps/api/src/modules/billing/billing-queue.module.ts':
        '// Registration is a single BullModule.registerQueue call, made by the helper.\n' +
        'export const q = registerQueueWithDefaults(BILLING, BILLING_DEFAULTS);\n',
    });

    assert.deepEqual(runSync(queueRegistrationThroughHelperRule, fixture.context()), []);
  });

  /*
   * lint:meta scans `tools/`, so this rule reads its own definition, where the
   * banned call sits in the message string. A string is data, and reporting it
   * would be the rule mistaking its own source for a violation. Both spellings
   * are covered because a message is as likely to be a template literal.
   */
  it('passes a call named only inside a string, the way this rule names it itself', () => {
    const fixture = createFixture({
      'apps/api/src/modules/billing/message.ts':
        "export const MSG = 'Use the helper instead of BullModule.registerQueue(.';\n" +
        'export const ALSO = `never call BullModule.registerQueue({ name })`;\n',
    });

    assert.deepEqual(runSync(queueRegistrationThroughHelperRule, fixture.context()), []);
  });

  it('still reports a real call in a file that also names it in a comment and a string', () => {
    const fixture = createFixture({
      'apps/api/src/modules/billing/billing-queue.module.ts':
        '// Do not use BullModule.registerQueue here.\n' +
        "const why = 'BullModule.registerQueue omits defaultJobOptions';\n" +
        'export const q = BullModule.registerQueue({ name: BILLING });\n',
    });

    const violations = runSync(queueRegistrationThroughHelperRule, fixture.context());
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.file ?? '', /billing-queue\.module\.ts$/u);
  });
});

describe('a file list is a snapshot', () => {
  /*
   * pnpm test:lint-meta runs the codegen test, which invokes lint:meta, while
   * the edit-hook test writes and deletes a probe file under apps/api/src. The
   * resulting ENOENT has been seen on an unmodified tree in as many as 1 run out
   * of 3, and before per-rule isolation it aborted the
   * whole run.
   */
  it('skips a file that vanished after the glob, and still reports the ones that remain', () => {
    const fixture = createFixture({
      'apps/api/src/real.ts': '// eslint-disable-next-line no-console\nconsole.log(1);\n',
      'apps/api/src/gone.ts': '// eslint-disable-next-line no-console\nconsole.log(2);\n',
    });
    const context = fixture.context();
    rmSync(join(context.root, 'apps/api/src/gone.ts'));

    const violations = runSync(noInlineLintDisableRule, context);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.file ?? '', /real\.ts$/u);
  });

  it('still throws when the read fails for any other reason', () => {
    const fixture = createFixture({ 'apps/api/src/keep.ts': 'export const a = 1;\n' });
    const context = fixture.context();
    // A directory where a file was expected is a real fault, not a race.
    const directory = join(context.root, 'apps/api/src/aDirectory.ts');
    mkdirSync(directory, { recursive: true });

    assert.throws(() => runSync(noInlineLintDisableRule, { ...context, sourceFiles: [directory] }));
  });
});

describe('codeOnlySource', () => {
  it('blanks comments and string bodies while keeping every offset', () => {
    const source = "const a = 1; // note\nconst b = 'text';\n";
    const out = codeOnlySource(source, '/repo/apps/api/src/a.ts');

    assert.equal(out.length, source.length);
    assert.equal(out.includes('note'), false);
    assert.equal(out.includes('text'), false);
    assert.equal(out.includes('const a = 1;'), true);
    // The newline survives, so a blanked comment cannot glue two lines together.
    assert.equal(out.split('\n').length, source.split('\n').length);
  });
});

describe('isGenerated', () => {
  it('recognizes .gen files and generated directories, and nothing else', () => {
    assert.equal(isGenerated('/repo/apps/web/src/routeTree.gen.ts'), true);
    assert.equal(isGenerated('/repo/apps/web/src/routeTree.gen.tsx'), true);
    assert.equal(isGenerated('/repo/apps/api/src/@generated/server.ts'), true);
    assert.equal(isGenerated('/repo/packages/database/generated/prisma/client.ts'), true);
    assert.equal(isGenerated('/repo/apps/api/src/generator.ts'), false);
    assert.equal(isGenerated('/repo/apps/api/src/regen.ts'), false);
  });
});

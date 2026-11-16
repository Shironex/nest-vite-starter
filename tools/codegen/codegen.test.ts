import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { buildContext } from '../lint-meta/context';
import { META_RULES } from '../lint-meta/registry';
import type { IViolation } from '../lint-meta/types';
import { toKebab } from './codegen-utils';

/**
 * Drop SGR color sequences, so an assertion reads the same on a TTY and off one.
 *
 * The escape is built rather than written as a literal: a control character in a
 * regex literal is what `no-control-regex` exists to catch, and suppressing that
 * rule inline is not allowed in this repo.
 */
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR, '');
}

/*
 * The generators are run, not read.
 *
 * `new-feature.ts` and `new-component.ts` encode conventions that keep moving
 * (the tRPC option proxy, `pathKey()` invalidation, `route-i18n-side-effect`
 * placement, the six-file sibling set). Nothing imported them, so nothing failed
 * when a convention moved underneath them, and the first person to notice would
 * be whoever ran `pnpm new:feature` next. A generator that imports a missing
 * helper makes every generated resource fail type-check, and nobody notices
 * until then.
 *
 * So this suite generates a real feature, a real feature component and a real
 * UI component into the live tree, then puts the result through the same gates
 * hand-written code goes through: ESLint, `tsc --noEmit`, `lint:meta`, and the
 * generated component's own vitest test.
 *
 * THE LIVE TREE, deliberately. `codegen-utils.ts` pins `repoRoot` to
 * `process.cwd()`, so the generators could be pointed at a temp directory, but
 * the generated code imports `@/lib/i18n`, `@repo/ui` and the generated tRPC
 * router. Type-checking it anywhere else would either resolve nothing or need a
 * copy of the whole workspace. The names are random and every artifact is
 * removed in `after`, which node:test runs even when a test fails.
 *
 * Type-checking uses a throwaway project that extends the real one and includes
 * only the generated tree plus the ambient declarations, rather than
 * `pnpm check-types`: the compiler still loads the full import closure of the
 * generated files, which is the thing under test, and it does it in about ten
 * seconds instead of a minute.
 */

const root = process.cwd();
const WEB_PROBE = 'apps/web/tsconfig.codegen-probe.json';
const UI_PROBE = 'packages/ui/tsconfig.codegen-probe.json';
const UI_PACKAGE_JSON = 'packages/ui/package.json';

interface IRunResult {
  readonly ok: boolean;
  readonly output: string;
}

function run(command: string, args: readonly string[]): IRunResult {
  const result = spawnSync(command, [...args], { cwd: root, encoding: 'utf8' });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/** Run a generator exactly the way the documented `pnpm new:*` script does. */
function generate(script: string, argument: string): IRunResult {
  return run('pnpm', ['exec', 'tsx', `tools/codegen/${script}`, argument]);
}

/*
 * A name nothing in the tree already owns. A fixed name collided with real code
 * twice in the product this came from, and a collision here is worse than a
 * failure: the generator refuses to overwrite, so the suite would delete a real
 * feature folder on the way out.
 */
function freeName(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const name = `Codegen${randomBytes(4).toString('hex')}`;
    const feature = join(root, 'apps', 'web', 'src', 'features', toKebab(name));
    const uiComponent = join(root, 'packages', 'ui', 'src', 'components', `${toKebab(name)}.tsx`);

    if (!existsSync(feature) && !existsSync(uiComponent)) {
      return name;
    }
  }

  throw new Error('Could not find a free generated name in 20 attempts');
}

function metaViolations(): IViolation[] {
  // The sync pass only: the rules with an async pass read ESLint's resolved
  // config, which says nothing about generated source and needs the internal
  // plugin's dist to be built. The harness runs the registry in `pnpm lint:meta`;
  // here each rule is called directly, on one context built for the whole pass.
  const ctx = buildContext(root);
  const violations: IViolation[] = [];
  const failures: string[] = [];

  // A rule that throws is collected, not allowed to end the pass, and then
  // fails the test: otherwise a broken rule would reach this test as a quietly
  // shorter violation list, and the set arithmetic below would read it as a
  // clean generator.
  for (const rule of META_RULES) {
    try {
      violations.push(...(rule.run?.(ctx) ?? []));
    } catch (error) {
      failures.push(`${rule.id} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`lint-meta rules threw: ${failures.join(', ')}`);
  }

  return violations;
}

/** A violation's identity for set arithmetic, since IViolation has no id. */
function fingerprint(violation: IViolation): string {
  return `${violation.rule}\u0000${violation.file}\u0000${violation.message}`;
}

describe('codegen generators', () => {
  const feature = freeName();
  const featureDir = toKebab(feature);
  const component = `${feature}Panel`;
  const uiComponent = `${feature}Widget`;
  const uiKebab = toKebab(uiComponent);

  const featurePath = join('apps', 'web', 'src', 'features', featureDir);
  const componentPath = join(featurePath, 'components', component);
  const uiComponentPath = join('packages', 'ui', 'src', 'components', `${uiKebab}.tsx`);

  const uiPackageJsonBefore = readFileSync(join(root, UI_PACKAGE_JSON), 'utf8');
  let baseline = new Set<string>();
  let featureRun: IRunResult;
  let componentRun: IRunResult;
  let uiRun: IRunResult;
  // Snapshotted between the two runs: `new:component` adds `components/` to the
  // same folder, so the feature generator's own output cannot be read back
  // afterwards.
  let featureEntries: string[] = [];

  before(() => {
    baseline = new Set(metaViolations().map(fingerprint));

    featureRun = generate('new-feature.ts', feature);
    featureEntries = featureRun.ok ? readdirSync(join(root, featurePath)).sort() : [];
    componentRun = generate('new-component.ts', `${featureDir}/${component}`);
    uiRun = generate('new-component.ts', `ui/${uiComponent}`);

    writeFileSync(
      join(root, WEB_PROBE),
      `${JSON.stringify(
        {
          extends: './tsconfig.app.json',
          compilerOptions: { tsBuildInfoFile: null },
          include: [
            'src/vite-env.d.ts',
            'src/types',
            'src/test/setup.ts',
            `src/features/${featureDir}`,
          ],
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(root, UI_PROBE),
      `${JSON.stringify(
        { extends: './tsconfig.json', include: [`src/components/${uiKebab}.tsx`] },
        null,
        2,
      )}\n`,
    );
  });

  after(() => {
    rmSync(join(root, featurePath), { recursive: true, force: true });
    rmSync(join(root, uiComponentPath), { force: true });
    rmSync(join(root, WEB_PROBE), { force: true });
    rmSync(join(root, UI_PROBE), { force: true });
    // `new:component ui` edits packages/ui/package.json in place, so the file is
    // restored from the text captured before the run rather than patched back.
    writeFileSync(join(root, UI_PACKAGE_JSON), uiPackageJsonBefore);
  });

  it('new:feature writes the documented sibling set, including the i18n registration', () => {
    assert.ok(featureRun.ok, `pnpm new:feature failed:\n${featureRun.output}`);

    assert.deepEqual(featureEntries, [
      `${feature}.constants.ts`,
      `${feature}.i18n.ts`,
      `${feature}.mutations.ts`,
      `${feature}.queries.ts`,
      `${feature}.types.ts`,
      'locales',
    ]);
    assert.deepEqual(readdirSync(join(root, featurePath, 'locales')).sort(), ['en.json']);

    // The whole point of emitting the file: the namespace is registered and
    // named, so no caller repeats the string and no catalog goes unregistered.
    const i18n = readFileSync(join(root, featurePath, `${feature}.i18n.ts`), 'utf8');
    assert.match(i18n, new RegExp(`registerFeatureNamespace\\('${featureDir}'`, 'u'));
    assert.match(
      i18n,
      new RegExp(`export const ${featureDir.toUpperCase()}_NS = '${featureDir}'`, 'u'),
    );
    assert.match(i18n, /registerFeatureNamespace\('[^']+', \{ en \}\)/u);
  });

  it('new:component writes the six-file sibling set and registers the namespace', () => {
    assert.ok(componentRun.ok, `pnpm new:component failed:\n${componentRun.output}`);

    assert.deepEqual(readdirSync(join(root, componentPath)).sort(), [
      `${component}.hooks.ts`,
      `${component}.stories.tsx`,
      `${component}.test.tsx`,
      `${component}.tsx`,
      `${component}.types.ts`,
      'index.ts',
    ]);

    // The side-effect import belongs to the COMPONENT, not to a route
    // (`route-i18n-side-effect`), which is asserted by the lint:meta case below.
    const shell = readFileSync(join(root, componentPath, `${component}.tsx`), 'utf8');
    assert.match(shell, new RegExp(`^import '\\.\\./\\.\\./${feature}\\.i18n';$`, 'mu'));
  });

  it('new:component ui writes the component and its package export entry', () => {
    assert.ok(uiRun.ok, `pnpm new:component ui failed:\n${uiRun.output}`);
    assert.ok(existsSync(join(root, uiComponentPath)));

    const pkg: unknown = JSON.parse(readFileSync(join(root, UI_PACKAGE_JSON), 'utf8'));
    const exports =
      typeof pkg === 'object' && pkg !== null && 'exports' in pkg
        ? (pkg as { exports: Record<string, unknown> }).exports
        : {};

    assert.deepEqual(exports[`./${uiKebab}`], {
      import: `./src/components/${uiKebab}.tsx`,
    });
  });

  it('the generated tree passes ESLint', () => {
    const web = run('pnpm', [
      '--filter',
      '@repo/web',
      'exec',
      'eslint',
      `src/features/${featureDir}`,
      '--no-warn-ignored',
    ]);
    assert.ok(web.ok, `ESLint failed on the generated feature:\n${web.output}`);

    const ui = run('pnpm', [
      '--filter',
      '@repo/ui',
      'exec',
      'eslint',
      `src/components/${uiKebab}.tsx`,
      '--no-warn-ignored',
    ]);
    assert.ok(ui.ok, `ESLint failed on the generated UI component:\n${ui.output}`);
  });

  it('the generated tree type-checks', () => {
    const web = run('pnpm', [
      '--filter',
      '@repo/web',
      'exec',
      'tsc',
      '--noEmit',
      '-p',
      'tsconfig.codegen-probe.json',
    ]);
    assert.ok(web.ok, `tsc failed on the generated feature:\n${web.output}`);

    const ui = run('pnpm', [
      '--filter',
      '@repo/ui',
      'exec',
      'tsc',
      '--noEmit',
      '-p',
      'tsconfig.codegen-probe.json',
    ]);
    assert.ok(ui.ok, `tsc failed on the generated UI component:\n${ui.output}`);
  });

  it('the generated tree adds no lint:meta violation except the inventory row', () => {
    const added = metaViolations().filter((violation) => !baseline.has(fingerprint(violation)));

    /*
     * The follow-ups the generator prints, and only those. No generator writes
     * product docs, so a new feature directory needs a row in the web features
     * inventory and a purpose line in tools/arch/registry.ts; the map is stale
     * until both land and `pnpm generate:arch-map` runs.
     */
    assert.deepEqual(
      [...new Set(added.map((violation) => violation.rule))].sort(),
      ['arch-map-fresh', 'docs-feature-inventory-complete'],
      `Unexpected lint:meta violations:\n${added.map((v) => `${v.rule}: ${v.message}`).join('\n')}`,
    );
    assert.ok(
      added.some((violation) => violation.message.includes(featureDir)),
      `No violation named the generated feature:\n${added.map((v) => v.message).join('\n')}`,
    );
  });

  it("the generated component's own test passes", () => {
    const result = run('pnpm', [
      '--filter',
      '@repo/web',
      'exec',
      'vitest',
      'run',
      `src/features/${featureDir}`,
    ]);

    assert.ok(result.ok, `The generated component test failed:\n${result.output}`);
    /*
     * A vitest run that matched nothing also exits 0, so the count is asserted.
     * Strip ANSI first: vitest colorizes on CI and not through this pipe
     * locally, so matching the raw text passed here and failed on the runner
     * while the generated test had in fact passed.
     */
    assert.match(stripAnsi(result.output), /Test Files\s+1 passed \(1\)/u);
  });
});

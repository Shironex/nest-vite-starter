import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after } from 'node:test';

import { buildContext } from './context';
import type { IMetaContext, IMetaRule, IViolation } from './types';

/*
 * Fixture helpers for the lint-meta rule tests.
 *
 * Every rule test builds its own throwaway repository under the OS temp dir, so
 * a test never depends on what the live tree happens to contain today: the rule
 * is run against a tree the test wrote, and a green result means the rule
 * behaves, not that the repository is currently clean.
 */

export interface IFixture {
  /** Absolute path of the fixture repository root. */
  readonly root: string;
  /** Absolute path of a repo-relative POSIX path inside the fixture. */
  readonly path: (relative: string) => string;
  /** Write (or overwrite) files, keyed by repo-relative POSIX path. */
  readonly write: (files: Readonly<Record<string, string>>) => void;
  /** The context the CLI would build for this root. */
  readonly context: () => IMetaContext;
}

/**
 * A fresh fixture repository, removed after the enclosing suite finishes.
 *
 * Call it inside `describe` (or a test) so the cleanup hook attaches to that
 * suite. It carries a `pnpm-workspace.yaml` because the ESLint plugin's
 * `findRepoRoot` looks for that marker to find the monorepo root.
 */
export function createFixture(files: Readonly<Record<string, string>> = {}): IFixture {
  const root = mkdtempSync(join(tmpdir(), 'lint-meta-fixture-'));
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (entries: Readonly<Record<string, string>>): void => {
    for (const [relative, content] of Object.entries(entries)) {
      const absolute = join(root, ...relative.split('/'));
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
  };

  write({ 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'packages/*'\n", ...files });

  return {
    root,
    path: (relative) => join(root, ...relative.split('/')),
    write,
    context: () => buildContext(root),
  };
}

/** Run a rule's sync pass. A rule without one fails the test loudly instead of returning []. */
export function runSync(rule: IMetaRule, ctx: IMetaContext): IViolation[] {
  if (rule.run === undefined) {
    throw new Error(`Rule "${rule.id}" has no sync pass`);
  }
  return rule.run(ctx);
}

/** Run a rule's async pass. A rule without one fails the test loudly instead of returning []. */
export function runAsync(rule: IMetaRule, ctx: IMetaContext): Promise<IViolation[]> {
  if (rule.runAsync === undefined) {
    throw new Error(`Rule "${rule.id}" has no async pass`);
  }
  return rule.runAsync(ctx);
}

/** The rule ids of a violation list, in order. */
export function ruleIds(violations: readonly IViolation[]): string[] {
  return violations.map((violation) => violation.rule);
}

/** Every message of a violation list, in order. */
export function messages(violations: readonly IViolation[]): string[] {
  return violations.map((violation) => violation.message);
}

/**
 * A minimal flat ESLint config that registers stub plugin rules and sets them to
 * the given config entries, so the rules that read the RESOLVED config can be
 * exercised without the real plugin. `rules` maps a rule id (`plugin/name`) to
 * its config entry (`'error'`, `'warn'`, `['error', { ... }]`).
 */
export function eslintConfigSource(rules: Readonly<Record<string, unknown>>): string {
  const stubsByPlugin = new Map<string, string[]>();
  for (const ruleId of Object.keys(rules)) {
    const slash = ruleId.indexOf('/');
    if (slash === -1) {
      continue;
    }
    const namespace = ruleId.slice(0, slash);
    const stubs = stubsByPlugin.get(namespace) ?? [];
    stubs.push(ruleId.slice(slash + 1));
    stubsByPlugin.set(namespace, stubs);
  }

  const pluginSource = [...stubsByPlugin]
    .map(([namespace, names]) => {
      const stubSource = names
        .map((name) => `${JSON.stringify(name)}: { meta: { schema: false }, create: () => ({}) }`)
        .join(', ');
      return `${JSON.stringify(namespace)}: { rules: { ${stubSource} } }`;
    })
    .join(', ');

  return [
    'export default [',
    '  {',
    "    files: ['**/*.ts', '**/*.tsx'],",
    `    plugins: { ${pluginSource} },`,
    `    rules: ${JSON.stringify(rules)},`,
    '  },',
    '];',
    '',
  ].join('\n');
}

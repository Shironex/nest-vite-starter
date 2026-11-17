import { spawnSync } from 'node:child_process';
import {
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after } from 'node:test';

import type { IMetaCtx } from '@noctcore/harness';

/*
 * Fixture helpers for the lint-meta rule tests. Every test writes its own
 * throwaway repository under the OS temp dir and runs the rule against it, so
 * a green test means the rule behaves, not that the live tree is clean today.
 */

/** An `IMetaCtx` over `root`, the same shape the harness hands a rule. */
export function buildCtx(root: string): IMetaCtx {
  return {
    root,
    read: (rel) => {
      const file = join(root, rel);
      return existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/gu, '\n') : null;
    },
    exists: (rel) => existsSync(join(root, rel)),
    glob: (pattern) =>
      globSync(pattern, { cwd: root, exclude: (name) => name === 'node_modules' }).map((file) =>
        file.replace(/\\/gu, '/'),
      ),
    exec: (cmd) => {
      const result = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8' });
      return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
  };
}

export interface IFixture {
  readonly root: string;
  /** Write (or overwrite) files, keyed by repo-relative POSIX path. */
  readonly write: (files: Readonly<Record<string, string>>) => void;
  readonly ctx: () => IMetaCtx;
}

/** A fresh fixture repository, removed after the enclosing suite finishes. */
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
  return { root, write, ctx: () => buildCtx(root) };
}

/**
 * A minimal flat ESLint config that registers stub plugin rules and sets them to
 * the given entries, so the rules that read the RESOLVED config can be tested
 * without the real plugins. `rules` maps a rule id (`plugin/name`) to its entry.
 */
export function eslintConfigSource(rules: Readonly<Record<string, unknown>>): string {
  const stubsByPlugin = new Map<string, string[]>();
  for (const ruleId of Object.keys(rules)) {
    const slash = ruleId.indexOf('/');
    if (slash === -1) continue;
    const namespace = ruleId.slice(0, slash);
    stubsByPlugin.set(namespace, [
      ...(stubsByPlugin.get(namespace) ?? []),
      ruleId.slice(slash + 1),
    ]);
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

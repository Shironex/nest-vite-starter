import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as baseConfig } from '../base.js';
import { config as reactArchitectureConfig } from '../react-architecture.js';

/*
 * Wiring checks for the rules that report nothing on this tree today. A rule at
 * zero hits looks identical whether it is guarding or was never reached (a
 * `files` glob that matches nothing, an `include` that arms nothing), so each
 * one is fed a probe through the REAL exported config and must fire on it.
 *
 * The three nestjs.js rules wired alongside these live in
 * security-and-audit-wiring.test.js, which already pays for the type-aware
 * program that config builds; a second one here doubled that cost.
 */
let root;
let base;
let web;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dormant-guard-wiring-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  // The repo plugin resolves its globs against the nearest pnpm workspace root,
  // so without this marker it would match against a bare basename.
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n");
  base = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig });
  web = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    baseConfig: [...baseConfig, ...reactArchitectureConfig],
  });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function check(eslint, relativePath, body, ruleId) {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${body}\n`);
  const [result] = await eslint.lintFiles([file]);
  // A parse failure reports no rule at all, which would read as a pass.
  expect(result.messages.filter((m) => m.fatal)).toEqual([]);
  return result.messages.filter((m) => m.ruleId === ruleId);
}

describe('base.js: async-safety and shell rules', () => {
  it('forward-abort-signal flags a signal that never reaches the awaited work', async () => {
    const body = `export async function load(url: string, signal: AbortSignal) {
  if (signal.aborted) return null;
  return await fetch(url, { signal: AbortSignal.timeout(1000) });
}`;
    const hits = await check(
      base,
      'src/load.ts',
      body,
      'noctcore-async-safety/forward-abort-signal',
    );
    expect(hits).toHaveLength(1);
  });

  it('no-concurrent-shared-mutation flags a lost update in Promise.all', async () => {
    const body = `declare const items: number[]; declare function price(n: number): Promise<number>;
export async function sum() {
  let total = 0;
  await Promise.all(items.map(async (item) => { total += await price(item); }));
  return total;
}`;
    const hits = await check(
      base,
      'src/sum.ts',
      body,
      'noctcore-async-safety/no-concurrent-shared-mutation',
    );
    expect(hits).toHaveLength(1);
  });

  it('no-leaky-race-timeout flags a raced timeout that is never cleared', async () => {
    const body = `export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}`;
    const hits = await check(
      base,
      'src/with-timeout.ts',
      body,
      'noctcore-async-safety/no-leaky-race-timeout',
    );
    expect(hits).toHaveLength(1);
  });

  it('no-shell-interpolation flags an interpolated command string', async () => {
    const body = `import { exec } from 'node:child_process';
declare const branch: string;
exec(\`git checkout \${branch}\`);`;
    const hits = await check(base, 'src/git.ts', body, 'noctcore-security/no-shell-interpolation');
    expect(hits).toHaveLength(1);
  });

  it('no-timing-unsafe-compare flags an HMAC digest compared with ===', async () => {
    const body = `import { createHmac } from 'node:crypto';
export function verify(body: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  return expected === signature;
}`;
    const hits = await check(
      base,
      'src/verify.ts',
      body,
      'noctcore-security/no-timing-unsafe-compare',
    );
    expect(hits).toHaveLength(1);
  });
});

describe('base.js: code-quality rules', () => {
  it('no-elided-code-comments flags a placeholder standing in for deleted code', async () => {
    const body = `export class Cart {
  items: string[] = [];
  add(item: string) {
    this.items.push(item);
  }

  // ... other methods ...
}`;
    const hits = await check(base, 'src/cart.ts', body, 'code-quality/no-elided-code-comments');
    expect(hits).toHaveLength(1);
  });

  it('no-swallowed-assertion flags an expect whose catch drops the failure', async () => {
    const body = `declare function it(name: string, fn: () => Promise<void>): void;
declare function expect(value: unknown): { toBe(expected: unknown): void };
declare function loadCart(): Promise<{ size: number }>;
it('loads the cart', async () => {
  try {
    const cart = await loadCart();
    expect(cart.size).toBe(3);
  } catch (error) {
    console.warn('flaky, ignoring', error);
  }
});`;
    const hits = await check(base, 'src/cart.test.ts', body, 'code-quality/no-swallowed-assertion');
    expect(hits).toHaveLength(1);
  });
});

describe('react-architecture.js: React correctness rules', () => {
  it('no-effect-derived-state flags state copied from props in an effect', async () => {
    const body = `import { useEffect, useState } from 'react';
export function Doubled({ value }: { value: number }) {
  const [doubled, setDoubled] = useState(0);
  useEffect(() => { setDoubled(value * 2); }, [value]);
  return <span>{doubled}</span>;
}`;
    const hits = await check(
      web,
      'src/lib/Doubled.tsx',
      body,
      'noctcore-react/no-effect-derived-state',
    );
    expect(hits).toHaveLength(1);
  });

  it('prefer-lazy-state-init flags an eager JSON.parse initializer', async () => {
    const body = `import { useState } from 'react';
declare const raw: string;
export function useSaved() {
  const [saved] = useState(JSON.parse(raw));
  return saved;
}`;
    const hits = await check(
      web,
      'src/lib/useSaved.ts',
      body,
      'noctcore-react/prefer-lazy-state-init',
    );
    expect(hits).toHaveLength(1);
  });

  it('no-jsx-in-hooks flags a hook that renders', async () => {
    const body = `export function useBadge() {
  return <span>ok</span>;
}`;
    const hits = await check(web, 'src/lib/useBadge.tsx', body, 'noctcore-react/no-jsx-in-hooks');
    expect(hits).toHaveLength(1);
  });

  it('require-effect-cancellation flags a state update after an uncanceled await', async () => {
    const body = `import { useEffect, useState } from 'react';
declare function load(): Promise<string>;
export function useLoaded() {
  const [value, setValue] = useState('');
  useEffect(() => {
    void load().then((v) => { setValue(v); });
  }, []);
  return value;
}`;
    const hits = await check(
      web,
      'src/lib/useLoaded.ts',
      body,
      'noctcore-react/require-effect-cancellation',
    );
    expect(hits).toHaveLength(1);
  });
});

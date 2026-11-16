import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture } from '../lint-meta/test-support';
import { exportedNames, scanPackage } from './exports';

const SPEC = { name: '@repo/demo', dir: 'packages/demo' } as const;

function manifest(exportsMap: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ name: '@repo/demo', exports: exportsMap }, null, 2);
}

describe('scanPackage', () => {
  it('maps a dist subpath back to its source and lists what the barrel forwards', () => {
    const fixture = createFixture({
      'packages/demo/package.json': manifest({
        './money': {
          import: { types: './dist/money/index.d.ts', default: './dist/money/index.js' },
        },
      }),
      'packages/demo/src/money/index.ts':
        "export * from './format.js';\nexport const CURRENCY = 'USD';\n",
      'packages/demo/src/money/format.ts':
        'export function formatMoney(): string {\n  return "";\n}\nexport interface IMoney {\n  value: number;\n}\n',
    });

    const pkg = scanPackage(fixture.root, SPEC);

    assert.deepEqual(pkg.entries, [
      {
        specifier: '@repo/demo/money',
        source: 'packages/demo/src/money/index.ts',
        names: ['CURRENCY', 'formatMoney', 'IMoney'],
      },
    ]);
  });

  it('reads a source subpath directly and skips a css asset', () => {
    const fixture = createFixture({
      'packages/demo/package.json': manifest({
        './button': { import: './src/components/button.tsx' },
        './styles/globals.css': './src/styles/globals.css',
      }),
      'packages/demo/src/components/button.tsx':
        'export const Button = 1;\nexport default Button;\n',
      'packages/demo/src/styles/globals.css': 'body {}\n',
    });

    const pkg = scanPackage(fixture.root, SPEC);

    assert.equal(pkg.entries.length, 1);
    assert.equal(pkg.entries[0]?.specifier, '@repo/demo/button');
    assert.deepEqual(pkg.entries[0]?.names, ['Button']);
  });
});

describe('exportedNames', () => {
  it('reads named, default and type exports without following a package import', () => {
    const fixture = createFixture({
      'packages/demo/src/index.ts': [
        "export { a, b as c } from './other';",
        "export * from 'zod';",
        'export type Alias = string;',
        'export enum Mode {\n  On = 1,\n}',
        'export default function run(): void {}',
        'const hidden = 1;',
        'export { hidden };',
      ].join('\n'),
      'packages/demo/src/other.ts': 'export const a = 1;\nexport const b = 2;\n',
    });

    assert.deepEqual(exportedNames(fixture.path('packages/demo/src/index.ts')), [
      'a',
      'Alias',
      'c',
      'default',
      'hidden',
      'Mode',
      'run',
    ]);
  });
});

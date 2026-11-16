import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/*
 * `lint:fast` runs `eslint --cache` on apps/web, and ESLint keys a cached
 * result on the linted file's content and the resolved config, and on nothing
 * else. Two of the web's rules read something other than the file they report
 * on:
 *
 * - `contracts/translation-key-exists` reads the English catalogs, so deleting a
 *   key makes an unchanged component newly wrong;
 * - `architecture/component-folder-structure` checks that a component's sibling
 *   files exist, so deleting one makes the unchanged component newly wrong.
 *
 * apps/web/eslint.config.js folds the catalogs' content and the list of paths
 * under src/ into `settings`. Each case below runs twice: with the digest
 * pinned to a constant (the control, which must go stale, or the case proves
 * nothing) and with the shipped config (which must not).
 *
 * Same method as the api test: a scratch tree, the real config copied verbatim
 * beside fixture source, node_modules symlinked, one ESLint process per run.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = join(REPO_ROOT, 'apps', 'web');
const TRANSLATION_RULE = 'contracts/translation-key-exists';
const FOLDER_RULE = 'architecture/component-folder-structure';

const ESLINT_URL = pathToFileURL(
  createRequire(join(WEB_ROOT, 'package.json')).resolve('eslint'),
).href;

const WIDGET_DIR = join('src', 'features', 'probe', 'components', 'Widget');
const HOOKS_FILE = join(WIDGET_DIR, 'Widget.hooks.ts');
const COMPONENT_FILE = join(WIDGET_DIR, 'Widget.tsx');
const FEATURE_CATALOG = join('src', 'features', 'probe', 'locales', 'en.json');

const FIXTURE = {
  [join('src', 'lib', 'i18n', 'locales', 'en.json')]: '{ "common": {}, "errors": {} }\n',
  [FEATURE_CATALOG]: '{ "greeting": "Good morning" }\n',
  [HOOKS_FILE]: `import { useTranslation } from 'react-i18next';

export function useWidget(): string {
  const { t } = useTranslation('probe');
  return t('greeting');
}
`,
  [COMPONENT_FILE]: `import type { WidgetProps } from './Widget.types';

export default function Widget({ label }: WidgetProps) {
  return <span>{label}</span>;
}
`,
  [join(WIDGET_DIR, 'Widget.types.ts')]: 'export interface WidgetProps {\n  label: string;\n}\n',
  [join(WIDGET_DIR, 'Widget.stories.tsx')]: 'export default {};\n',
  [join(WIDGET_DIR, 'Widget.test.tsx')]: 'export {};\n',
  [join(WIDGET_DIR, 'index.ts')]: "export { default } from './Widget';\n",
};

const RUNNER = `
const { ESLint } = await import(process.env.PROBE_ESLINT_URL);
const eslint = new ESLint({
  cwd: process.cwd(),
  cache: true,
  cacheLocation: process.env.PROBE_CACHE,
  cacheStrategy: 'content',
  overrideConfig: process.env.PROBE_PIN_DIGEST
    ? { settings: { starterRuleInputs: 'pinned' } }
    : undefined,
});
const [result] = await eslint.lintFiles([process.env.PROBE_FILE]);
const rules = process.env.PROBE_RULES.split(',');
const relevant = result.messages.filter((m) => m.fatal || rules.includes(m.ruleId));
process.stdout.write(JSON.stringify(relevant.map((m) => m.ruleId ?? m.message)));
`;

const scratchRoots = [];
after(() => {
  for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
});

function scratchTree() {
  const root = mkdtempSync(join(tmpdir(), 'lint-cache-web-digest-'));
  scratchRoots.push(root);
  const web = join(root, 'apps', 'web');

  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  mkdirSync(web, { recursive: true });
  // package.json carries `"type": "module"`, which the .js config needs.
  for (const file of ['eslint.config.js', 'package.json', 'tsconfig.json']) {
    cpSync(join(WEB_ROOT, file), join(web, file));
  }
  symlinkSync(join(WEB_ROOT, 'node_modules'), join(web, 'node_modules'), 'dir');
  for (const [file, text] of Object.entries(FIXTURE)) {
    mkdirSync(dirname(join(web, file)), { recursive: true });
    writeFileSync(join(web, file), text);
  }
  return { web, cache: join(root, 'eslint-cache') };
}

function lint(tree, file, { pinDigest = false } = {}) {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER], {
    cwd: tree.web,
    encoding: 'utf8',
    env: {
      ...process.env,
      PROBE_ESLINT_URL: ESLINT_URL,
      PROBE_CACHE: tree.cache,
      PROBE_FILE: join(tree.web, file),
      PROBE_PIN_DIGEST: pinDigest ? '1' : '',
      PROBE_RULES: [TRANSLATION_RULE, FOLDER_RULE].join(','),
    },
  });
  assert.equal(run.status, 0, `eslint run failed:\n${run.stderr}`);
  return JSON.parse(run.stdout);
}

const CASES = [
  {
    name: 'a key deleted from the catalog',
    file: HOOKS_FILE,
    rule: TRANSLATION_RULE,
    edit: (tree) => writeFileSync(join(tree.web, FEATURE_CATALOG), '{}\n'),
  },
  {
    name: "a component's sibling test deleted",
    file: COMPONENT_FILE,
    rule: FOLDER_RULE,
    edit: (tree) => rmSync(join(tree.web, WIDGET_DIR, 'Widget.test.tsx')),
  },
];

describe('web lint:fast cache and the rule-inputs digest', () => {
  for (const { name, file, rule, edit } of CASES) {
    it(`${name}: reported on a cold run (the probe is live)`, () => {
      const tree = scratchTree();
      assert.deepEqual(lint(tree, file), [], 'the probe must lint clean before the edit');
      edit(tree);
      rmSync(tree.cache, { force: true });
      assert.ok(lint(tree, file).includes(rule), `a cold run must report ${rule}`);
    });

    it(`${name}: CONTROL, with the digest pinned a warm cache hides it`, () => {
      const tree = scratchTree();
      assert.deepEqual(lint(tree, file, { pinDigest: true }), []);
      edit(tree);
      assert.deepEqual(
        lint(tree, file, { pinDigest: true }),
        [],
        'without the digest the cached clean result must survive; if it does not, this is no longer the proof',
      );
    });

    it(`${name}: with the shipped config a warm cache still reports it`, () => {
      const tree = scratchTree();
      assert.deepEqual(lint(tree, file), []);
      assert.deepEqual(lint(tree, file), [], 'second run, warm cache, nothing changed');
      edit(tree);
      assert.ok(lint(tree, file).includes(rule), `the warm run after the edit must report ${rule}`);
    });
  }
});

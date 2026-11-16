import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { config as baseConfig } from '../base.js';
import { config as nestjsConfig } from '../nestjs.js';
import { config as reactArchitectureConfig } from '../react-architecture.js';
import { config as reactConfig } from '../react.js';

/*
 * Every rule a consumed @noctcore plugin turns on in its `recommended` preset
 * is either wired at "error" by one of this package's exported configs, or is
 * listed below with the reason it is not.
 *
 * This repo wires noctcore rules one by one and spreads no noctcore preset, so
 * nothing a publisher does to a preset reaches it on its own: a new rule, or a
 * rule promoted from "warn" to "error", lands in node_modules and changes
 * nothing here. That is the same failure as a caret range that cannot reach a
 * published minor, one layer up, and it is invisible in the same way: lint
 * stays green. This test turns such a release into a red test that names the
 * rule, so adopting it or listing it becomes a decision someone makes.
 *
 * A listed rule that is later wired, or that leaves the preset, also fails, so
 * the list cannot silently outlive its reasons.
 *
 * Hit counts below are the preset's own options run over `src/` of api, web,
 * desktop, ui, shared, database and email, measured when the list was written.
 */
const NOT_ADOPTED = {
  'noctcore-architecture/barrel-purity':
    'Not reviewed. 153 hits (shared 93, web 28, email 19, desktop 13).',
  'noctcore-architecture/filename-matches-export':
    'Not reviewed. 417 hits (web 340, ui 32, api 22, email 19, desktop 3, database 1).',
  'noctcore-architecture/max-import-depth':
    'Not reviewed. 39 hits, all in apps/api; adopting it means choosing a depth for that tree.',
  'noctcore-code-quality/prefer-early-return':
    "Wired 'off' in base.js, which records the sites it waits on; the no-warn policy rules out a 'warn' rollout. 24 hits.",
  'noctcore-contracts/zod-schema-naming':
    'Not reviewed. 206 hits (shared 202, api 2, desktop 2); the shared schemas are imported by web and api, so a rename there is coordinated.',
  'noctcore-contracts/wire-message-naming':
    'Not reviewed. 0 hits, so wiring it needs a probe in dormant-guard-wiring.test.js first.',
  'noctcore-contracts/money-must-be-decimal':
    'Dormant by decision until the first money field lands: docs/decisions/2026-09-22-money.md and the note in nestjs.js.',
  'noctcore-contracts/require-error-cause': 'Not reviewed. 11 hits, all in apps/api.',
  'noctcore-observability/no-error-detail-loss':
    'Not reviewed. 0 hits, so wiring it needs a probe in dormant-guard-wiring.test.js first.',
  'noctcore-react/component-props-naming': 'Not reviewed. 121 hits (web 88, ui 33).',
  'noctcore-react/context-value-must-be-memoized': 'Not reviewed. 1 hit, in packages/ui.',
  'noctcore-react/max-hook-return-surface': 'Not reviewed. 9 hits, all in apps/web.',
  'noctcore-react/max-props-per-component': 'Not reviewed. 4 hits (ui 3, web 1).',
  'noctcore-react/no-prop-drilling': 'Not reviewed. 1 hit, in apps/web.',
};

const EXPORTED_CONFIGS = [baseConfig, reactConfig, reactArchitectureConfig, nestjsConfig];

const manifest = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
);

const PLUGIN_PACKAGES = Object.keys(manifest.dependencies ?? {}).filter((name) =>
  name.startsWith('@noctcore/eslint-plugin-'),
);

const severityOf = (value) => (Array.isArray(value) ? value[0] : value);
const isOn = (value) => severityOf(value) !== 'off' && severityOf(value) !== 0;
const isError = (value) => severityOf(value) === 'error' || severityOf(value) === 2;

function presetRuleIds(plugin) {
  const blocks = [plugin.configs?.recommended ?? []].flat();
  return blocks.flatMap((block) =>
    Object.entries(block.rules ?? {})
      .filter(([, value]) => isOn(value))
      .map(([id]) => id),
  );
}

/**
 * Rule names wired at "error" for `plugin`. The namespaces come from the plugin
 * OBJECT each block registers, not from the preset's prefix, because this repo
 * registers the same package as `contracts` where the preset says
 * `noctcore-contracts`. Rules are then read from every block, because flat
 * config lets a block set a rule whose plugin another block registered.
 */
function wiredAtError(plugin) {
  const blocks = EXPORTED_CONFIGS.flat();
  const namespaces = new Set(
    blocks.flatMap((block) =>
      Object.entries(block.plugins ?? {})
        .filter(([, registered]) => registered === plugin)
        .map(([namespace]) => namespace),
    ),
  );
  const names = new Set();
  for (const block of blocks) {
    for (const [id, value] of Object.entries(block.rules ?? {})) {
      const slash = id.indexOf('/');
      if (slash > 0 && namespaces.has(id.slice(0, slash)) && isError(value)) {
        names.add(id.slice(slash + 1));
      }
    }
  }
  return names;
}

const plugins = await Promise.all(
  PLUGIN_PACKAGES.map(async (name) => ({ name, plugin: (await import(name)).default })),
);

describe('noctcore preset adoption', () => {
  it('checks every @noctcore plugin this package declares', () => {
    expect(plugins.length).toBe(8);
    for (const { name, plugin } of plugins) {
      expect(presetRuleIds(plugin).length, `${name} has no recommended preset`).toBeGreaterThan(0);
    }
  });

  for (const { name, plugin } of plugins) {
    it(`${name}: every preset rule is wired at error or listed`, () => {
      const wired = wiredAtError(plugin);
      const unaccounted = presetRuleIds(plugin).filter(
        (id) => !wired.has(id.split('/')[1] ?? '') && !(id in NOT_ADOPTED),
      );
      expect(
        unaccounted,
        `${name} turns these on in its recommended preset and nothing here wires them. Wire each at 'error' in the matching config (with a probe in dormant-guard-wiring.test.js if it reports 0 hits), or add it to NOT_ADOPTED with the measured reason.`,
      ).toEqual([]);
    });
  }

  it('lists only rules that are in a preset and not wired', () => {
    const presetIds = new Set(plugins.flatMap(({ plugin }) => presetRuleIds(plugin)));
    const wiredIds = new Set(
      plugins.flatMap(({ plugin }) => {
        const prefix = presetRuleIds(plugin)[0]?.split('/')[0];
        return [...wiredAtError(plugin)].map((rule) => `${prefix}/${rule}`);
      }),
    );
    const stale = Object.keys(NOT_ADOPTED).filter((id) => !presetIds.has(id) || wiredIds.has(id));
    expect(
      stale,
      'These NOT_ADOPTED entries are wired or no longer in a preset: delete them.',
    ).toEqual([]);
  });
});

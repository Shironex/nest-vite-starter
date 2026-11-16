import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SINGLE_SEMANTIC_CONSTANTS_BACKLOG,
  SINGLE_SEMANTIC_UTILS_BACKLOG,
  config as baseConfig,
} from '../base.js';

/*
 * Wiring checks for `architecture/single-semantic-module` as base.js scopes it,
 * run through the REAL exported config: what is under test is the file-kind
 * globs, the allow groups and the backlog ignores, which a RuleTester with
 * hand-copied options would only mirror.
 */
const RULE = 'architecture/single-semantic-module';
const REPO_ROOT = join(import.meta.dirname, '../../..');

let root;
let eslint;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'single-semantic-module-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  eslint = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Lint `body` as `relativePath` and return this rule's messages. */
async function check(relativePath, body) {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${body}\n`);
  const [result] = await eslint.lintFiles([file]);
  return result.messages.filter((m) => m.ruleId === RULE);
}

const TYPE = 'export interface IThing { id: string }';
const CONSTANT = "export const THING_QUEUE = 'thing';";
const FUNCTION = 'export function thingKey(id: string): string { return id; }';

describe('single-semantic-module wiring', () => {
  it('holds a .types file to type space', async () => {
    expect(await check('src/thing/thing.types.ts', TYPE)).toEqual([]);
    expect(await check('src/thing/thing.types.ts', `${TYPE}\n${CONSTANT}`)).toHaveLength(1);
  });

  it('lets a .constants file mix constants and types, but not functions', async () => {
    expect(await check('src/thing/thing.constants.ts', `${CONSTANT}\n${TYPE}`)).toEqual([]);
    expect(await check('src/thing/thing.constants.ts', `${CONSTANT}\n${FUNCTION}`)).toHaveLength(1);
  });

  it('lets a .util file export functions with their types, but not constants', async () => {
    expect(await check('src/thing/thing.util.ts', `${FUNCTION}\n${TYPE}`)).toEqual([]);
    expect(await check('src/thing/thing.util.ts', `${FUNCTION}\n${CONSTANT}`)).toHaveLength(1);
  });

  it('leaves other file kinds alone', async () => {
    expect(await check('src/thing/thing.service.ts', `${CONSTANT}\n${FUNCTION}\n${TYPE}`)).toEqual(
      [],
    );
  });

  it('exempts a backlog file by exact path but not a new file beside it', async () => {
    const mixed = `${CONSTANT}\n${FUNCTION}`;
    expect(await check('src/modules/auth/auth.constants.ts', mixed)).toEqual([]);
    expect(await check('src/modules/auth/auth-new.constants.ts', mixed)).toHaveLength(1);
  });

  // The backlogs only shrink: an entry whose file was fixed (or deleted) is a
  // permission nobody is using, so it must go. Each real file is linted under a
  // path outside the backlog, where it must still break the rule.
  it.each([
    ...SINGLE_SEMANTIC_CONSTANTS_BACKLOG.map((path) => [path, 'unlisted.constants.ts']),
    ...SINGLE_SEMANTIC_UTILS_BACKLOG.map((path) => [path, 'unlisted.util.ts']),
  ])('keeps %s on the backlog only while it still breaks the rule', async (path, probe) => {
    const source = readFileSync(join(REPO_ROOT, path), 'utf8');
    expect(
      await check(`src/probe/${probe}`, source),
      `${path} now passes: drop it from the backlog`,
    ).toHaveLength(1);
  });
});

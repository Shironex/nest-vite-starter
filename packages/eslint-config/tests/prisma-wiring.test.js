import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRISMA_DELEGATE_METHODS,
  delegateAccessor,
  loadPrismaSchema,
  parsePrismaSchema,
  relationFieldsForModels,
  resolveSchemaPath,
} from '@noctcore/eslint-plugin-prisma';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import { config as nestjsConfig } from '../nestjs.js';

/*
 * The Prisma rules come from @noctcore/eslint-plugin-prisma, which knows no
 * SaaS Starter model, file or schema path: every one of those is an option passed in
 * nestjs.js. So what can break here is the WIRING, and two kinds of it break
 * silently:
 *
 *  - `restrict-model-writes` carries three fences in one option list. Dropping
 *    an entry leaves the rule at "error" (so `required-rules-at-error` stays
 *    green) and removes a fence. The first block lints a write to each guarded
 *    model from a non-owner file, through the REAL config, and expects a report.
 *  - The published rules read Prisma's method surface and this repo's schema.
 *    Both move under them: Prisma adds a method, or the schema folder moves and
 *    the relation derivation returns nothing. Neither breaks a build, and each
 *    disarms fences at once. The last two blocks read the generated client and
 *    the real schema and go red instead.
 */
const REPO_ROOT = join(import.meta.dirname, '../../..');
const API_DIR = join(REPO_ROOT, 'apps/api');
const FENCE_RULE = 'noctcore-prisma/restrict-model-writes';

/** The options nestjs.js gives the fence rule, as ESLint receives them. */
function fenceOptions() {
  const block = nestjsConfig.find((entry) => entry.rules && FENCE_RULE in entry.rules);
  return block.rules[FENCE_RULE][1];
}

describe('restrict-model-writes: every single-writer fence is wired', () => {
  let eslint;

  beforeAll(async () => {
    // The type-aware block needs every linted file on disk inside a tsconfig
    // project; these probes are in-memory, and no Prisma rule is type-aware.
    const untyped = nestjsConfig.filter(
      (entry) => entry.languageOptions?.parserOptions?.projectService !== true,
    );
    eslint = new ESLint({ cwd: API_DIR, overrideConfigFile: true, baseConfig: untyped });
    // Pay the parser and schema load once here, not inside the first case.
    await eslint.lintText('export {};\n', {
      filePath: join(API_DIR, 'src/modules/example/warmup.ts'),
    });
  }, 60_000);

  it('is wired with no single-writer fence yet', () => {
    expect(fenceOptions().restrictions).toEqual([]);
  });
});

/*
 * THE METHOD-SET DRIFT GATE. The published method lists are hand-written, so
 * they can fall behind the client: Prisma adds a method and it is invisible to
 * the soft-delete rule, every single-writer fence and both transaction rules at
 * once. The generated `<Model>Delegate` interface is the client's real method
 * surface. `generated/` is gitignored and produced by `db:generate`; a missing
 * client fails LOUDLY here rather than skipping.
 */
const GENERATED_MODELS_DIR = join(REPO_ROOT, 'packages/database/generated/prisma/models');

/**
 * Members of `export interface <Model>Delegate<...> { ... }`: one method per line
 * at a single indent, so a line scan is enough. `fields` (no generic) and
 * `$`-prefixed members are not query methods and are dropped.
 */
function delegateMethodNames(source, model) {
  const start = source.indexOf(`export interface ${model}Delegate<`);
  if (start === -1) return [];
  const names = new Set();
  for (const line of source.slice(start).split('\n').slice(1)) {
    if (line.startsWith('}')) break;
    const member = /^ {2}([A-Za-z_]\w*)</.exec(line);
    if (member?.[1] !== undefined) names.add(member[1]);
  }
  return [...names].sort();
}

function readGeneratedDelegates() {
  return readdirSync(GENERATED_MODELS_DIR)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => {
      const model = name.replace(/\.ts$/, '');
      const source = readFileSync(join(GENERATED_MODELS_DIR, name), 'utf8');
      return [model, delegateMethodNames(source, model)];
    })
    .filter(([, methods]) => methods.length > 0);
}

describe('prisma method surface', () => {
  it('the generated Prisma client is present, so this gate is actually running', () => {
    expect(
      existsSync(GENERATED_MODELS_DIR),
      `No generated Prisma client at ${GENERATED_MODELS_DIR}. Run \`pnpm --filter @repo/database db:generate\`.`,
    ).toBe(true);
    // AuditLog, SecondFactor, Token and User today.
    expect(readGeneratedDelegates().length).toBeGreaterThanOrEqual(4);
  });

  it('every model delegate exposes the same method surface', () => {
    const delegates = readGeneratedDelegates();
    const [, reference] = delegates[0] ?? ['', []];
    for (const [model, methods] of delegates) {
      expect(methods, `${model}Delegate diverges from the first delegate read`).toEqual(reference);
    }
  });

  it('the published PRISMA_DELEGATE_METHODS is exactly the generated delegate surface', () => {
    const [, methods] = readGeneratedDelegates()[0] ?? ['', []];
    expect([...PRISMA_DELEGATE_METHODS].sort()).toEqual(methods);
  });
});

/*
 * THE SCHEMA DRIFT GATE. The fence derives the relation fields that reach a
 * guarded model from the schema at `schemaPath`. It goes quiet three ways, all
 * silent: the folder moves and the path stops resolving, the parser rots
 * against new schema syntax, or it parses and finds no relation for a model
 * that plainly has them. Run against the REAL schema.
 */

/** The schema folder as one string, read independently of the plugin's loader. */
function readWholeSchema(target) {
  if (!statSync(target).isDirectory()) return readFileSync(target, 'utf8');
  return readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.prisma'))
    .map((entry) => entry.name)
    .sort()
    .map((name) => readFileSync(join(target, name), 'utf8'))
    .join('\n');
}

/** Independent of the parser on purpose: a dumb regex over the raw text. */
function modelNamesByRegex(source) {
  return [...source.matchAll(/^model\s+([A-Za-z_]\w*)\s*\{/gm)].map((match) => match[1]);
}

describe('restrict-model-writes schema derivation', () => {
  const schemaPath = () =>
    resolveSchemaPath(
      join(API_DIR, 'src/modules/example/example.service.ts'),
      fenceOptions().schemaPath,
    );

  it('the configured schemaPath resolves to a schema holding at least one model', () => {
    expect(existsSync(schemaPath())).toBe(true);
    expect(modelNamesByRegex(readWholeSchema(schemaPath())).length).toBeGreaterThan(0);
  });

  it('the parser finds exactly the models a dumb regex finds', () => {
    const source = readWholeSchema(schemaPath());
    expect(parsePrismaSchema(source).models).toEqual(modelNamesByRegex(source));
  });

  it('every guarded model is in the schema and reachable through at least one relation', () => {
    const parsed = loadPrismaSchema(schemaPath());
    const declared = new Set(parsed.models.map(delegateAccessor));
    for (const { models } of fenceOptions().restrictions) {
      for (const model of models) {
        expect(declared).toContain(model);
        expect([...relationFieldsForModels(parsed, [model])].length).toBeGreaterThan(0);
      }
    }
  });
});

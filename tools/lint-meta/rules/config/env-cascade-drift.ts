import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

const SCHEMA_FILE = join('apps', 'api', 'src', 'config', 'configuration.config.ts');
const ENV_EXAMPLE_FILE = '.env.example';

/** Joi keys are declared as `KEY: Joi.<...>` inside the validation schema. */
const JOI_KEY = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*Joi\./u;

/** dotenv assignments: `KEY=value`, ignoring comments and blanks. */
const DOTENV_KEY = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/u;

function parseJoiKeys(file: string): string[] {
  const keys: string[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = JOI_KEY.exec(line);
    if (match?.[1] !== undefined) {
      keys.push(match[1]);
    }
  }
  return keys;
}

function parseDotenvKeys(file: string): Set<string> {
  const keys = new Set<string>();
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const match = DOTENV_KEY.exec(line);
    if (match?.[1] !== undefined) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/** Where the ConfigService lives. Specs mock it with keys production never reads. */
const API_SOURCE = 'apps/api/src/';

/*
 * A config read: `<something>config(Service)?.get|getOrThrow<T>('KEY')`, or the
 * same call given a SCREAMING_SNAKE identifier.
 *
 * Keyed on the receiver's name rather than on `.get(`, which every Map and
 * Reflector in the tree also answers to. The key itself must be SCREAMING_SNAKE,
 * which is what an env key is.
 */
const CONFIG_READ =
  /[\w.$]*[Cc]onfig(?:Service)?\.(?:get|getOrThrow)(?:<[^>]*>)?\(\s*(?:'([A-Z][A-Z0-9_]*)'|"([A-Z][A-Z0-9_]*)"|([A-Z][A-Z0-9_]*)\s*[,)])/gu;

/** A module-scope `const NAME = 'VALUE'`, for a read given a constant. */
const STRING_CONSTANT = /\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]*)?=\s*'([^']*)'/gu;

/**
 * The env keys one file reads, resolving a constant argument through its own
 * declaration.
 *
 * A constant declared in ANOTHER module is skipped rather than guessed at: the
 * sites that pass one (arm flags for destructive sweeps) declare it beside the
 * read, so resolving within the file is enough today and a cross-module
 * constant simply goes unchecked instead of being invented.
 */
export function readConfigKeys(source: string): string[] {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(STRING_CONSTANT)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      constants.set(match[1], match[2]);
    }
  }

  const keys = new Set<string>();
  for (const match of source.matchAll(CONFIG_READ)) {
    const literal = match[1] ?? match[2];
    if (literal !== undefined) {
      keys.add(literal);
      continue;
    }
    const resolved = match[3] === undefined ? undefined : constants.get(match[3]);
    if (resolved !== undefined) {
      keys.add(resolved);
    }
  }

  return [...keys].sort();
}

/*
 * The second direction: every key the api ASKS the ConfigService for must be a
 * key the Joi schema declares.
 *
 * Joi is what turns a missing or malformed value into a boot failure with the
 * key's name in it. A key read but never declared skips that entirely: it
 * arrives as `undefined` at run time, in whichever code path happens to need
 * it, long after the deploy that forgot it.
 */
function checkConfigReadsAreDeclared(
  ctx: IMetaContext,
  joiKeys: ReadonlySet<string>,
): IViolation[] {
  const violations: IViolation[] = [];

  for (const file of ctx.sourceFiles) {
    const display = relative(ctx.root, file).split(sep).join('/');
    if (!display.startsWith(API_SOURCE) || display.endsWith('.spec.ts')) {
      continue;
    }

    for (const key of readConfigKeys(readFileSync(file, 'utf8'))) {
      if (joiKeys.has(key)) {
        continue;
      }
      violations.push({
        file: display,
        rule: 'env-cascade-drift',
        message: `\`${key}\` is read from the ConfigService but is not declared in the Joi schema (${SCHEMA_FILE}), so a deployment that omits it boots fine and fails later, wherever this value is first needed. Declare it (and seed it in .env.example).`,
      });
    }
  }

  return violations;
}

/*
 * Direction is schema -> .env.example only: every key the API's Joi schema
 * reads must be documented in .env.example so operators have a seed value. The
 * reverse (example key not in schema) is deliberately NOT checked: .env.example
 * is shared with the web build (VITE_*), docker-compose (POSTGRES_*,
 * REDIS_PASSWORD), and the observability stack (GRAFANA_*, *_RETENTION_*), none
 * of which the API ConfigService reads. Checking it would be all false
 * positives.
 */
export function checkEnvCascadeDrift(ctx: IMetaContext): IViolation[] {
  const schemaFile = join(ctx.root, SCHEMA_FILE);
  const envExampleFile = join(ctx.root, ENV_EXAMPLE_FILE);

  if (!existsSync(schemaFile)) {
    return [];
  }

  const joiKeys = parseJoiKeys(schemaFile);
  const violations: IViolation[] = [];

  if (existsSync(envExampleFile)) {
    const envKeys = parseDotenvKeys(envExampleFile);

    for (const key of joiKeys) {
      if (!envKeys.has(key)) {
        violations.push({
          file: envExampleFile,
          rule: 'env-cascade-drift',
          message: `\`${key}\` is validated by the Joi schema (${SCHEMA_FILE}) but missing from .env.example. Add it so operators have a documented seed value.`,
        });
      }
    }
  }

  violations.push(...checkConfigReadsAreDeclared(ctx, new Set(joiKeys)));

  return violations;
}

/** The Joi schema, .env.example and the api's config reads all name the same keys. */
export const envCascadeDriftRule: IMetaRule = {
  id: 'env-cascade-drift',
  category: 'config',
  ciCritical: true,
  description:
    'Joi env-schema keys must be documented in .env.example, and every key the api reads from the ConfigService must be declared in the Joi schema.',
  run(ctx: IMetaContext): IViolation[] {
    return checkEnvCascadeDrift(ctx);
  },
};

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../lint-meta/types';

const RULE_ID = 'config-surface-complete';

/** The manifest this rule keeps honest. */
export const MANIFEST_PATH = 'tools/starter/starter-manifest.json';

const ENV_EXAMPLE = '.env.example';
const JOI_SCHEMA = 'apps/api/src/config/configuration.config.ts';
/** `env-no-direct-import-meta-env` already makes this the only reader of `VITE_*` in the SPA. */
const WEB_ENV_MODULE = 'apps/web/src/lib/env.ts';
const VITE_CONFIG = 'apps/web/vite.config.ts';
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.prod.yml'] as const;

/*
 * Where a `process.env` read counts as a config key. The api and the database
 * package (client and seeds) are the processes
 * a deployment configures. Specs and tests are not: they set keys to prove
 * behavior, and those are not part of what an operator configures.
 */
const PROCESS_ENV_GLOBS = [
  'apps/api/src/**/*.ts',
  'packages/database/src/**/*.ts',
  'packages/database/prisma/*.ts',
] as const;
const TEST_FILE = /\.(?:spec|test)\.tsx?$/u;

type GroupKind = 'core' | 'presence' | 'select' | 'flag';
const GROUP_KINDS: readonly GroupKind[] = ['core', 'presence', 'select', 'flag'];

interface IGroup {
  readonly kind: GroupKind;
  readonly toggle?: string;
  readonly description: string;
  readonly keys: readonly string[];
  readonly secrets: readonly string[];
  readonly required: readonly string[];
  readonly prodRequired: readonly string[];
  readonly services: readonly string[];
}

interface IAndRule {
  readonly id: string;
  readonly kind: 'and';
  readonly keys: readonly string[];
}

interface IRequiredWhenRule {
  readonly id: string;
  readonly kind: 'requiredWhen';
  readonly key: string;
  readonly when: { readonly key: string; readonly is: string };
  readonly enforcedAtBoot: boolean;
}

type CrossRule = IAndRule | IRequiredWhenRule;

export interface IConfigSurfaceManifest {
  readonly groups: Readonly<Record<string, IGroup>>;
  readonly crossRules: readonly CrossRule[];
  readonly waived: Readonly<Record<string, string>>;
}

/** One `.when('KEY', { is: 'v', then: ... })` inside a Joi declaration. */
interface IJoiWhen {
  readonly key: string;
  readonly is: string;
  readonly thenRequires: boolean;
}

/** One top-level `KEY: Joi...` declaration, comments stripped. */
export interface IJoiDeclaration {
  readonly key: string;
  readonly whens: readonly IJoiWhen[];
  /** `.required()` outside any `.when`, so it applies in every environment. */
  readonly required: boolean;
}

export interface IJoiSchema {
  readonly declarations: readonly IJoiDeclaration[];
  /** Every `.and(...)` on the object, as sorted key lists. */
  readonly andGroups: readonly (readonly string[])[];
}

const JOI_KEY = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*Joi\./u;
const LINE_COMMENT = /(^|[^:'"`\\])\/\/.*$/u;

/** The text of `.when(` ... `)` calls, found by paren depth so nested `Joi.x()` calls do not end it early. */
function extractWhenCalls(body: string): { calls: string[]; rest: string } {
  const calls: string[] = [];
  let rest = '';
  let cursor = 0;
  for (;;) {
    const start = body.indexOf('.when(', cursor);
    if (start === -1) {
      rest += body.slice(cursor);
      break;
    }
    rest += body.slice(cursor, start);
    let depth = 0;
    let end = start + '.when'.length;
    for (; end < body.length; end += 1) {
      const char = body[end];
      if (char === '(') depth += 1;
      if (char === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(body.slice(start + '.when('.length, end));
    cursor = end + 1;
  }
  return { calls, rest };
}

function parseWhen(call: string): IJoiWhen | null {
  const key = /^\s*'([A-Z][A-Z0-9_]*)'/u.exec(call)?.[1];
  const is = /\bis:\s*'([^']*)'/u.exec(call)?.[1];
  const thenAt = call.search(/\bthen:/u);
  if (key === undefined || is === undefined || thenAt === -1) return null;
  const otherwiseAt = call.search(/\botherwise:/u);
  const thenPart = call.slice(thenAt, otherwiseAt === -1 ? undefined : otherwiseAt);
  return { key, is, thenRequires: /\brequired\(\)/u.test(thenPart) };
}

/**
 * The Joi schema's declarations, read line by line the way `env-cascade-drift`
 * reads its keys. A declaration runs from its `KEY: Joi.` line to the next one,
 * or to the `})` that closes the object.
 */
export function parseJoiSchema(source: string): IJoiSchema {
  const bodies: { key: string; lines: string[] }[] = [];
  const code = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => line.replace(LINE_COMMENT, '$1'));
  let closed = false;
  for (const line of code) {
    const match = JOI_KEY.exec(line);
    if (match?.[1] !== undefined) {
      bodies.push({ key: match[1], lines: [line] });
      closed = false;
      continue;
    }
    if (/^\s*\}\)/u.test(line)) closed = true;
    if (!closed) bodies.at(-1)?.lines.push(line);
  }

  const declarations = bodies.map(({ key, lines }) => {
    const { calls, rest } = extractWhenCalls(lines.join('\n'));
    const whens = calls.map(parseWhen).filter((when): when is IJoiWhen => when !== null);
    return { key, whens, required: /\.required\(\)/u.test(rest) };
  });

  const andGroups: string[][] = [];
  for (const match of code.join('\n').matchAll(/\.and\(([^)]*)\)/gu)) {
    const keys = [...(match[1] ?? '').matchAll(/'([A-Z][A-Z0-9_]*)'/gu)].map((key) => key[1] ?? '');
    andGroups.push(keys.sort());
  }

  return { declarations, andGroups };
}

/** `KEY=value`, active or commented out: a commented default is still a documented key. */
export function readEnvExampleKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const line of source.split('\n')) {
    const key = /^#?\s*([A-Z][A-Z0-9_]*)=/u.exec(line.trim())?.[1];
    if (key !== undefined) keys.add(key);
  }
  return [...keys];
}

export function readProcessEnvKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const match of source.matchAll(
    /process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\])/gu,
  )) {
    const key = match[1] ?? match[2];
    if (key !== undefined) keys.add(key);
  }
  return [...keys];
}

/** Top-level service names: two-space-indented keys under `services:`. */
export function readComposeServices(source: string): string[] {
  const services: string[] = [];
  let inServices = false;
  for (const line of source.split('\n')) {
    if (/^services:\s*$/u.test(line)) {
      inServices = true;
      continue;
    }
    if (/^\S/u.test(line)) inServices = false;
    const name = inServices ? /^ {2}([A-Za-z0-9._-]+):/u.exec(line)?.[1] : undefined;
    if (name !== undefined) services.push(name);
  }
  return services;
}

const unique = (values: Iterable<string>): string[] => [...new Set(values)];

function isFile(root: string, rel: string): boolean {
  try {
    return statSync(join(root, rel)).isFile();
  } catch {
    return false;
  }
}

/** Every key the repo reads or documents, with the first file that names it. */
function collectSurface(ctx: IMetaContext): Map<string, string> {
  const surface = new Map<string, string>();
  const add = (keys: readonly string[], file: string): void => {
    for (const key of keys) {
      if (!surface.has(key)) surface.set(key, file);
    }
  };

  const envExample = ctx.read(ENV_EXAMPLE);
  if (envExample !== null) add(readEnvExampleKeys(envExample), ENV_EXAMPLE);

  const joi = ctx.read(JOI_SCHEMA);
  if (joi !== null) {
    add(
      parseJoiSchema(joi).declarations.map((declaration) => declaration.key),
      JOI_SCHEMA,
    );
  }

  const webEnv = ctx.read(WEB_ENV_MODULE);
  if (webEnv !== null) {
    add(
      unique([...webEnv.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/gu)].map((m) => m[1] ?? '')),
      WEB_ENV_MODULE,
    );
  }

  const viteConfig = ctx.read(VITE_CONFIG);
  if (viteConfig !== null) {
    add(
      unique([...viteConfig.matchAll(/readEnv\(\s*'([A-Z][A-Z0-9_]*)'/gu)].map((m) => m[1] ?? '')),
      VITE_CONFIG,
    );
  }

  for (const file of COMPOSE_FILES) {
    const compose = ctx.read(file);
    if (compose === null) continue;
    add(unique([...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/gu)].map((m) => m[1] ?? '')), file);
  }

  for (const pattern of PROCESS_ENV_GLOBS) {
    // A glob can return a directory whose name ends in `.ts`; read files only.
    for (const file of ctx.glob(pattern).sort()) {
      if (TEST_FILE.test(file) || !isFile(ctx.root, file)) continue;
      add(readProcessEnvKeys(readFileSync(join(ctx.root, file), 'utf8')), file);
    }
  }

  return surface;
}

function violation(file: string, message: string): IViolation {
  return { file, rule: RULE_ID, message };
}

/** Fail closed on a manifest this rule cannot read, rather than passing on nothing. */
function readManifest(ctx: IMetaContext): IConfigSurfaceManifest | IViolation {
  const raw = ctx.read(MANIFEST_PATH);
  if (raw === null) {
    return violation(
      MANIFEST_PATH,
      `${MANIFEST_PATH} is missing, so nothing records which feature owns which environment key.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return violation(MANIFEST_PATH, `${MANIFEST_PATH} is not valid JSON: ${String(error)}`);
  }
  const manifest = parsed as Partial<IConfigSurfaceManifest>;
  if (
    typeof manifest.groups !== 'object' ||
    manifest.groups === null ||
    !Array.isArray(manifest.crossRules) ||
    typeof manifest.waived !== 'object' ||
    manifest.waived === null
  ) {
    return violation(
      MANIFEST_PATH,
      `${MANIFEST_PATH} must hold \`groups\` (an object), \`crossRules\` (an array) and \`waived\` (an object).`,
    );
  }
  return manifest as IConfigSurfaceManifest;
}

const LIST_FIELDS = ['keys', 'secrets', 'required', 'prodRequired', 'services'] as const;

/** The shape of each group, and every key sitting in exactly one place. */
function checkGroups(manifest: IConfigSurfaceManifest): {
  owner: Map<string, string>;
  violations: IViolation[];
} {
  const violations: IViolation[] = [];
  const owner = new Map<string, string>();

  for (const [name, group] of Object.entries(manifest.groups)) {
    const malformed = LIST_FIELDS.filter((field) => !Array.isArray(group[field]));
    if (!GROUP_KINDS.includes(group.kind) || malformed.length > 0) {
      violations.push(
        violation(
          MANIFEST_PATH,
          `Group \`${name}\` needs a \`kind\` of ${GROUP_KINDS.join(', ')} and array fields ${LIST_FIELDS.join(', ')}${malformed.length > 0 ? ` (missing or not an array: ${malformed.join(', ')})` : ''}.`,
        ),
      );
      continue;
    }

    const keys = new Set(group.keys);
    for (const key of group.keys) {
      const previous = owner.get(key);
      if (previous !== undefined) {
        violations.push(
          violation(
            MANIFEST_PATH,
            `\`${key}\` is listed in both \`${previous}\` and \`${name}\`. A key belongs to exactly one group, so a wizard never has two answers for it.`,
          ),
        );
      }
      owner.set(key, name);
    }

    if (group.kind !== 'core' && (group.toggle === undefined || !keys.has(group.toggle))) {
      violations.push(
        violation(
          MANIFEST_PATH,
          `Group \`${name}\` is kind \`${group.kind}\`, so its \`toggle\` must name one of its own keys.`,
        ),
      );
    }

    for (const field of ['secrets', 'required', 'prodRequired'] as const) {
      for (const key of group[field]) {
        if (!keys.has(key)) {
          violations.push(
            violation(
              MANIFEST_PATH,
              `\`${key}\` is in \`${name}.${field}\` but not in \`${name}.keys\`.`,
            ),
          );
        }
      }
    }

    for (const key of group.secrets) {
      if (key.startsWith('VITE_')) {
        violations.push(
          violation(
            MANIFEST_PATH,
            `\`${key}\` is marked secret, but Vite inlines every \`VITE_\` key into the public bundle. Rename it, or it is not a secret.`,
          ),
        );
      }
    }
  }

  for (const key of Object.keys(manifest.waived)) {
    const group = owner.get(key);
    if (group !== undefined) {
      violations.push(
        violation(
          MANIFEST_PATH,
          `\`${key}\` is both modeled in \`${group}\` and waived. Pick one.`,
        ),
      );
    }
    if (String(manifest.waived[key] ?? '').trim() === '') {
      violations.push(violation(MANIFEST_PATH, `The waiver for \`${key}\` gives no reason.`));
    }
  }

  return { owner, violations };
}

/** Every key the repo names is modeled or waived, and every modeled key still exists. */
function checkCompleteness(
  surface: ReadonlyMap<string, string>,
  owner: ReadonlyMap<string, string>,
  manifest: IConfigSurfaceManifest,
): IViolation[] {
  const violations: IViolation[] = [];
  const waived = new Set(Object.keys(manifest.waived));

  for (const [key, file] of [...surface].sort(([a], [b]) => a.localeCompare(b))) {
    if (owner.has(key) || waived.has(key)) continue;
    violations.push(
      violation(
        file,
        `\`${key}\` is part of the config surface but ${MANIFEST_PATH} does not model it. Add it to the group of the feature it configures, or to \`waived\` with the reason it is not configuration.`,
      ),
    );
  }

  for (const key of [...owner.keys(), ...waived].sort()) {
    if (surface.has(key)) continue;
    violations.push(
      violation(
        MANIFEST_PATH,
        `\`${key}\` is listed in ${MANIFEST_PATH} but nothing reads or documents it any more (${ENV_EXAMPLE}, the Joi schema, ${WEB_ENV_MODULE}, ${VITE_CONFIG}, the compose files, or a process.env read). Remove the stale entry.`,
      ),
    );
  }

  return violations;
}

function checkServices(ctx: IMetaContext, manifest: IConfigSurfaceManifest): IViolation[] {
  const known = new Set<string>();
  for (const file of COMPOSE_FILES) {
    const compose = ctx.read(file);
    if (compose !== null) readComposeServices(compose).forEach((service) => known.add(service));
  }
  const violations: IViolation[] = [];
  for (const [name, group] of Object.entries(manifest.groups)) {
    for (const service of Array.isArray(group.services) ? group.services : []) {
      if (!known.has(service)) {
        violations.push(
          violation(
            MANIFEST_PATH,
            `Group \`${name}\` adds compose service \`${service}\`, which no compose file (${COMPOSE_FILES.join(', ')}) defines.`,
          ),
        );
      }
    }
  }
  return violations;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);

/** The manifest's boot requirements and cross-rules agree with Joi, in both directions. */
function checkJoiAgreement(joi: IJoiSchema, manifest: IConfigSurfaceManifest): IViolation[] {
  const violations: IViolation[] = [];
  const groups = Object.values(manifest.groups).filter((group) => Array.isArray(group.keys));
  const declared = new Map(joi.declarations.map((declaration) => [declaration.key, declaration]));

  const requirement = (
    field: 'required' | 'prodRequired',
    joiSays: (declaration: IJoiDeclaration) => boolean,
    wording: string,
  ): void => {
    const modelled = new Set(groups.flatMap((group) => group[field] ?? []));
    for (const declaration of joi.declarations) {
      if (joiSays(declaration) && !modelled.has(declaration.key)) {
        violations.push(
          violation(
            JOI_SCHEMA,
            `Joi ${wording} \`${declaration.key}\`, but the manifest does not list it in \`${field}\`, so a setup wizard reading the manifest would let a deployment omit it.`,
          ),
        );
      }
    }
    for (const key of modelled) {
      const declaration = declared.get(key);
      if (declaration === undefined || !joiSays(declaration)) {
        violations.push(
          violation(
            MANIFEST_PATH,
            `\`${key}\` is in \`${field}\`, but Joi does not ${wording.replace('requires', 'require')} it. Either Joi lost the requirement or the manifest is stale.`,
          ),
        );
      }
    }
  };

  requirement('required', (d) => d.required, 'requires, in every environment,');
  requirement(
    'prodRequired',
    (d) =>
      !d.required &&
      d.whens.some((w) => w.key === 'NODE_ENV' && w.is === 'production' && w.thenRequires),
    'requires, in production only,',
  );

  const andRules = manifest.crossRules.filter((rule): rule is IAndRule => rule.kind === 'and');
  for (const rule of andRules) {
    if (!joi.andGroups.some((keys) => sameSet(keys, rule.keys))) {
      violations.push(
        violation(
          MANIFEST_PATH,
          `Cross-rule \`${rule.id}\` says ${rule.keys.join(' and ')} are set together, but the Joi schema has no matching \`.and(...)\`, so boot does not enforce it.`,
        ),
      );
    }
  }
  for (const keys of joi.andGroups) {
    if (!andRules.some((rule) => sameSet(rule.keys, keys))) {
      violations.push(
        violation(
          JOI_SCHEMA,
          `Joi enforces \`.and(${keys.join(', ')})\` but ${MANIFEST_PATH} has no \`and\` cross-rule for it.`,
        ),
      );
    }
  }

  const whenRules = manifest.crossRules.filter(
    (rule): rule is IRequiredWhenRule => rule.kind === 'requiredWhen',
  );
  for (const rule of whenRules) {
    const enforced =
      declared
        .get(rule.key)
        ?.whens.some((w) => w.key === rule.when.key && w.is === rule.when.is && w.thenRequires) ??
      false;
    if (enforced !== (rule.enforcedAtBoot === true)) {
      violations.push(
        violation(
          enforced ? MANIFEST_PATH : JOI_SCHEMA,
          enforced
            ? `Joi now requires \`${rule.key}\` when ${rule.when.key}=${rule.when.is}; set \`enforcedAtBoot: true\` on cross-rule \`${rule.id}\`.`
            : `Cross-rule \`${rule.id}\` says \`${rule.key}\` is required when ${rule.when.key}=${rule.when.is} and is enforced at boot, but the Joi declaration has no \`.when('${rule.when.key}', { is: '${rule.when.is}', then: ...required() })\`.`,
        ),
      );
    }
  }
  for (const declaration of joi.declarations) {
    for (const when of declaration.whens) {
      if (when.key === 'NODE_ENV' || !when.thenRequires) continue;
      const modelled = whenRules.some(
        (rule) =>
          rule.key === declaration.key && rule.when.key === when.key && rule.when.is === when.is,
      );
      if (!modelled) {
        violations.push(
          violation(
            JOI_SCHEMA,
            `Joi requires \`${declaration.key}\` when ${when.key}=${when.is}, but ${MANIFEST_PATH} has no \`requiredWhen\` cross-rule for it.`,
          ),
        );
      }
    }
  }

  return violations;
}

export function checkConfigSurface(ctx: IMetaContext): IViolation[] {
  const manifest = readManifest(ctx);
  if ('rule' in manifest) return [manifest];

  const joiSource = ctx.read(JOI_SCHEMA);
  if (joiSource === null) {
    return [
      violation(
        JOI_SCHEMA,
        `The Joi schema is missing, so the manifest's boot requirements cannot be checked. Update JOI_SCHEMA in tools/starter/config-surface.ts rather than dropping the check.`,
      ),
    ];
  }
  const joi = parseJoiSchema(joiSource);
  if (joi.declarations.length === 0) {
    return [
      violation(JOI_SCHEMA, 'No `KEY: Joi.` declaration could be read, so nothing can be checked.'),
    ];
  }

  const { owner, violations } = checkGroups(manifest);
  return [
    ...violations,
    ...checkCompleteness(collectSurface(ctx), owner, manifest),
    ...checkServices(ctx, manifest),
    ...checkJoiAgreement(joi, manifest),
  ];
}

/**
 * The config-surface manifest names every environment key, once, and agrees
 * with what Joi enforces at boot.
 */
export const configSurfaceCompleteRule: IMetaRule = {
  id: RULE_ID,
  category: 'config',
  ciCritical: true,
  description:
    'Every environment key the repo reads or documents belongs to exactly one group of tools/starter/starter-manifest.json (or is waived with a reason), no listed key is stale, and its boot requirements and cross-rules match the Joi schema.',
  run(ctx: IMetaContext): IViolation[] {
    return checkConfigSurface(ctx);
  },
};

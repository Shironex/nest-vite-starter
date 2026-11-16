import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as nestjsConfig } from '../nestjs.js';

/*
 * Wiring checks for the published @noctcore rules enabled in nestjs.js, run
 * through the REAL exported config rather than a RuleTester: what is under test
 * is the option object this repo passes and the file globs it scopes to, which a
 * RuleTester with hand-copied options would only mirror. The fixture project is
 * written to a temp dir laid out like apps/api (a tsconfig.json and a src/
 * tree) so the blocks' `src/**` globs match exactly as they do for the api.
 */
const REPO_ROOT = join(import.meta.dirname, '../../..');

let root;
let eslint;

/** The `[severity, options]` entry `nestjs.js` gives colocated-test-required. */
function backlogRuleEntry() {
  const RULE = 'architecture/colocated-test-required';
  const block = nestjsConfig.find((entry) => entry.rules && RULE in entry.rules);
  return block.rules[RULE];
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'nestjs-noctcore-rules-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022'],
        types: [],
        strict: true,
        noEmit: true,
      },
      include: ['src'],
    }),
  );
  eslint = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig: nestjsConfig });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Lint `body` as `relativePath` and return the messages of one rule. */
async function lint(relativePath, body, ruleId) {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${body}\n`);
  const [result] = await eslint.lintFiles([file]);
  return result.messages.filter((m) => m.ruleId === ruleId);
}

describe('contracts/restrict-throw-to-taxonomy', () => {
  const RULE = 'contracts/restrict-throw-to-taxonomy';
  const check = (path, body) => lint(path, body, RULE);

  it('reports a bare Error: the published default allow list would let it through', async () => {
    const messages = await check(
      'src/modules/billing/billing.service.ts',
      "export function run(): never {\n  throw new Error('boom');\n}",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain('`Error`');
  });

  it('passes the taxonomy: DomainError subclasses, InvariantError, TRPCError', async () => {
    for (const name of ['NotFoundError', 'ConflictError', 'InvariantError', 'TRPCError']) {
      const messages = await check(
        'src/modules/billing/billing.service.ts',
        `declare const ${name}: new (m: string) => Error;\nexport function run(): never {\n  throw new ${name}('x');\n}`,
      );
      expect(messages, name).toEqual([]);
    }
  });

  it('passes a re-throw of a caught error', async () => {
    const messages = await check(
      'src/modules/billing/billing.service.ts',
      'export function run(work: () => void): void {\n  try {\n    work();\n  } catch (error) {\n    throw error;\n  }\n}',
    );
    expect(messages).toEqual([]);
  });

  it('reports a Nest built-in in a service', async () => {
    const messages = await check(
      'src/modules/billing/billing.service.ts',
      "declare const NotFoundException: new (m: string) => Error;\nexport function run(): never {\n  throw new NotFoundException('x');\n}",
    );
    expect(messages).toHaveLength(1);
  });

  it('passes a Nest built-in in a plain-HTTP controller', async () => {
    const messages = await check(
      'src/modules/uploads/upload.controller.ts',
      "declare const NotFoundException: new (m: string) => Error;\nexport function run(): never {\n  throw new NotFoundException('x');\n}",
    );
    expect(messages).toEqual([]);
  });

  it('still reports a bare Error in a controller', async () => {
    const messages = await check(
      'src/modules/uploads/upload.controller.ts',
      "export function run(): never {\n  throw new Error('boom');\n}",
    );
    expect(messages).toHaveLength(1);
  });

  it('leaves specs and contract-suite test support alone', async () => {
    const body = "export function run(): never {\n  throw new Error('boom');\n}";
    expect(await check('src/modules/billing/billing.service.spec.ts', body)).toEqual([]);
    expect(await check('src/modules/billing/x.contract-suite.ts', body)).toEqual([]);
  });
});

describe('observability/structured-log-arguments', () => {
  const RULE = 'observability/structured-log-arguments';
  const check = (path, body) => lint(path, body, RULE);
  const PRELUDE = 'declare const logger: Record<string, (...a: unknown[]) => void>;';

  it('reports a value interpolated into the message, on every tracked level', async () => {
    for (const method of ['debug', 'info', 'warn', 'error']) {
      const messages = await check(
        'src/modules/billing/billing.service.ts',
        `${PRELUDE}\nexport function run(id: string): void {\n  logger.${method}(\`failed for \${id}\`);\n}`,
      );
      expect(messages, method).toHaveLength(1);
    }
  });

  it('passes a static message with a structured context', async () => {
    const messages = await check(
      'src/modules/billing/billing.service.ts',
      `${PRELUDE}\nexport function run(id: string): void {\n  logger.warn('failed', { id });\n}`,
    );
    expect(messages).toEqual([]);
  });

  it('leaves specs alone', async () => {
    const messages = await check(
      'src/modules/billing/billing.service.spec.ts',
      `${PRELUDE}\nexport function run(id: string): void {\n  logger.warn(\`failed for \${id}\`);\n}`,
    );
    expect(messages).toEqual([]);
  });

  // Pins the upstream gap so it is a decision when it closes, not a surprise:
  // 0.1.0 tracks info/warn/error/debug only, so Nest's `.log()` is invisible.
  // When @noctcore ships a `methods` option, pass it in nestjs.js and flip this.
  it('does not see Nest logger.log (upstream methods option not published)', async () => {
    const messages = await check(
      'src/modules/billing/billing.service.ts',
      `${PRELUDE}\nexport function run(id: string): void {\n  logger.log(\`failed for \${id}\`);\n}`,
    );
    expect(messages).toEqual([]);
  });
});

describe('observability/no-sensitive-fields-in-logs', () => {
  const RULE = 'observability/no-sensitive-fields-in-logs';
  const check = (path, body) => lint(path, body, RULE);
  const PRELUDE = 'declare const logger: Record<string, (...a: unknown[]) => void>;';

  it('reports the published defaults', async () => {
    const messages = await check(
      'src/modules/billing/billing.service.ts',
      `${PRELUDE}\nexport function run(password: string): void {\n  logger.info('login', { password });\n}`,
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  // The whole point of passing denyNames: these are not in the published 7-name
  // default, so they only report because nestjs.js mirrors the runtime
  // redaction list.
  it('reports names only the repo denylist carries', async () => {
    for (const name of ['sessionId', 'userEmail']) {
      const messages = await check(
        'src/modules/billing/billing.service.ts',
        `${PRELUDE}\nexport function run(${name}: string): void {\n  logger.info('seen', { ${name} });\n}`,
      );
      expect(messages.length, name).toBeGreaterThan(0);
    }
  });

  it('passes identifiers and a literal that merely mentions a sensitive word', async () => {
    const messages = await check(
      'src/modules/billing/billing.service.ts',
      `${PRELUDE}\nexport function run(userId: string): void {\n  logger.info('password reset email sent', { userId });\n}`,
    );
    expect(messages).toEqual([]);
  });

  it('leaves specs alone', async () => {
    const messages = await check(
      'src/modules/billing/billing.service.spec.ts',
      `${PRELUDE}\nexport function run(password: string): void {\n  logger.info('login', { password });\n}`,
    );
    expect(messages).toEqual([]);
  });
});

describe('architecture/colocated-test-required', () => {
  const RULE = 'architecture/colocated-test-required';
  const check = (path, body) => lint(path, body, RULE);
  const BODY = 'export const value = 1;';

  it('reports a service and a processor with no colocated spec', async () => {
    for (const path of [
      'src/modules/billing/orphan.service.ts',
      'src/modules/billing/orphan.processor.ts',
    ]) {
      const messages = await check(path, BODY);
      expect(messages, path).toHaveLength(1);
      expect(messages[0].message).toContain('no colocated test');
    }
  });

  // A directory of its own: the rule caches directory listings for the process,
  // so a spec written into a folder already read would not be seen.
  it('passes once the sibling spec exists', async () => {
    mkdirSync(join(root, 'src/modules/tested'), { recursive: true });
    writeFileSync(join(root, 'src/modules/tested/tested.service.spec.ts'), `${BODY}\n`);
    expect(await check('src/modules/tested/tested.service.ts', BODY)).toEqual([]);
  });

  it('does not ask for a spec of a non-service file', async () => {
    expect(await check('src/modules/billing/billing.repository.ts', BODY)).toEqual([]);
  });

  it('does not ask a spec to have a spec', async () => {
    expect(await check('src/modules/billing/other.service.spec.ts', BODY)).toEqual([]);
  });

  // The backlog only shrinks: a line whose file gained a spec (or was deleted)
  // is a permission nobody is using, so it must go.
  it('keeps every backlog entry pointing at a real service that still has no spec', () => {
    const [, options] = backlogRuleEntry();
    for (const glob of options.ignore) {
      const file = join(REPO_ROOT, 'apps/api/src', glob.replace(/^\*\*\//u, ''));
      expect(existsSync(file), `${glob} no longer exists: drop it from the backlog`).toBe(true);
      const spec = file.replace(/\.ts$/u, '.spec.ts');
      expect(existsSync(spec), `${glob} now has a spec: drop it from the backlog`).toBe(false);
    }
  });
});

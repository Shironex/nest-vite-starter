import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as baseConfig } from '../base.js';
import { config as nestjsConfig } from '../nestjs.js';

/*
 * Wiring checks for the trust vocabulary base.js gives the two
 * @noctcore/eslint-plugin-security rules, and for the registry nestjs.js gives
 * observability/audit-pii-declared, plus the two request-lifetime rules and
 * the mass-assignment rule nestjs.js arms on production source. Run through the
 * REAL exported configs: the entries are source-text matches, so a renamed call
 * site or a mistyped entry shows up here as a flag or a silent pass.
 */
let root;
let base;
let nest;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'security-and-audit-wiring-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  // nestjs.js has a type-aware block over src/**, so the fixture needs a
  // project for `projectService` to resolve, laid out like apps/api.
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noEmit: true,
        types: [],
      },
      include: ['src'],
    }),
  );
  base = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig });
  nest = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig: nestjsConfig });

  // Pay the parser and type-aware program load once here, not inside whichever
  // case happens to run first. nestjs.js has a `projectService` block over
  // src/**, so that first lint builds a TypeScript program; under a loaded
  // release profile it alone can exceed vitest's 5s per-case default, which is
  // how this suite took down `unit` twice while passing on its own.
  const warm = join(root, 'src/warmup.ts');
  mkdirSync(dirname(warm), { recursive: true });
  writeFileSync(warm, 'export {};\n');
  await nest.lintFiles([warm]);
  await base.lintText('export {};\n', { filePath: warm });
}, 60_000);

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

const REDIRECT = 'noctcore-security/no-user-controlled-redirect';
const FETCH = 'noctcore-security/no-user-controlled-fetch-url';
const AUDIT = 'observability/audit-pii-declared';

describe('no-user-controlled-redirect wiring', () => {
  const redirectingClass = (
    url,
  ) => `declare const res: any; declare const flow: any; declare const provider: any;
class C { shared: any; go() { res.redirect(302, ${url}); } }`;

  it('flags the stored returnTo appended to the app origin unsanitized', async () => {
    const body = redirectingClass('`${this.shared.appUrl}${flow.returnTo}`');
    expect(await check(base, 'src/oauth.controller.ts', body, REDIRECT)).toHaveLength(1);
  });

  it.each([
    ['a sanitized returnTo', '`${this.shared.appUrl}${sanitizeReturnTo(flow.returnTo)}`'],
    ['the 2FA challenge path', '`${this.shared.appUrl}${OAUTH_TWO_FACTOR_CHALLENGE_PATH}`'],
    ['the auth error builder', 'buildAuthErrorRedirect(this.shared.appUrl, "x")'],
    ['the provider authorization URL', '(await provider.buildAuthorizationUrl({})).toString()'],
  ])('accepts %s', async (_label, url) => {
    const body = redirectingClass(url).replace('go()', 'async go()');
    expect(await check(base, 'src/oauth.controller.ts', body, REDIRECT)).toEqual([]);
  });
});

describe('no-user-controlled-fetch-url wiring', () => {
  it('accepts a validated ticket path on the api origin, and flags a raw one', async () => {
    const pre = 'declare const url: string; declare const s: AbortSignal;';
    const safe = `${pre} fetch(\`\${getApiBaseUrl()}\${toApiPath(url)}\`, { signal: s });`;
    const raw = `${pre} fetch(\`\${getApiBaseUrl()}\${url}\`, { signal: s });`;
    expect(await check(base, 'src/Thing.download.ts', safe, FETCH)).toEqual([]);
    expect(await check(base, 'src/Thing.download.ts', raw, FETCH)).toHaveLength(1);
  });

  it('does not police test files', async () => {
    const body =
      'declare const url: string; declare const s: AbortSignal; fetch(url, { signal: s });';
    expect(await check(base, 'src/thing.spec.ts', body, FETCH)).toEqual([]);
  });
});

describe('audit-pii-declared wiring', () => {
  const audit = (metadata) =>
    `class S { auditService: any; async run() { await this.auditService.log({ action: 'a', metadata: ${metadata} }); } }`;

  it('accepts the registered email-change keys', async () => {
    const body = audit('{ newEmail: "x" }');
    expect(await check(nest, 'src/modules/x/x.service.ts', body, AUDIT)).toEqual([]);
  });

  it('flags an undeclared PII-shaped key', async () => {
    const body = audit('{ phone: "x" }');
    expect(await check(nest, 'src/modules/x/x.service.ts', body, AUDIT)).toHaveLength(1);
  });

  it('flags an opaque payload outside the named pass-through files', async () => {
    const body = `declare const bag: object; ${audit('{ ...bag }')}`;
    expect(await check(nest, 'src/modules/x/x.service.ts', body, AUDIT)).toHaveLength(1);
  });
});

describe('request-lifetime rules wiring', () => {
  const MODULE_STATE = 'noctcore-async-safety/no-shared-mutable-module-state';
  const moduleCache = `const cache = new Map<string, number>();
export async function remember(key: string) {
  cache.set(key, 1);
}`;

  // Zero hits on the tree when wired, so each needs a probe that fires.
  it('no-shared-mutable-module-state is armed on api production source', async () => {
    const hits = await check(nest, 'src/modules/x/x.service.ts', moduleCache, MODULE_STATE);
    expect(hits).toHaveLength(1);
  });

  it('no-shared-mutable-module-state leaves specs alone', async () => {
    const hits = await check(nest, 'src/modules/x/x.service.spec.ts', moduleCache, MODULE_STATE);
    expect(hits).toEqual([]);
  });

  it('require-path-containment flags request input joined into a path', async () => {
    const body = `import path from 'node:path';
declare const req: { params: { file: string } };
export const file = path.join('/srv/files', req.params.file);`;
    const hits = await check(
      nest,
      'src/modules/x/x.controller.ts',
      body,
      'noctcore-security/require-path-containment',
    );
    expect(hits).toHaveLength(1);
  });
});

describe('no-request-body-in-write wiring', () => {
  // Zero hits on the tree when wired, so it needs a probe that fires.
  it('no-request-body-in-write flags the raw request body as write data', async () => {
    const body = `declare const req: { body: unknown };
declare const prisma: { note: { create(args: { data: unknown }): Promise<unknown> } };
export async function create() {
  await prisma.note.create({ data: req.body });
}`;
    const hits = await check(
      nest,
      'src/modules/x/x.controller.ts',
      body,
      'noctcore-prisma/no-request-body-in-write',
    );
    expect(hits).toHaveLength(1);
  });
});

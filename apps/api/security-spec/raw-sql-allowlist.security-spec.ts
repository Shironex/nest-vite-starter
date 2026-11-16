/**
 * SEC-005: raw SQL is an unreviewed door past every model-level guard.
 * The soft-delete filters, the select allowlists and the parameter binding of
 * the query builder all live on the Prisma MODEL, and a raw query has none, so
 * `$queryRaw` / `$executeRaw` (and above all the `Unsafe` variants) skip them
 * and type-check anyway.
 *
 * Fixed by a lint rule that treats raw SQL as an escape hatch with an
 * allowlist, pinned at error.
 *
 * The fix is a lint rule, so the thing that regresses is not a function's
 * behavior but the tree: a new raw query that nobody allowlisted. Both
 * directions are checked here against the RESOLVED repo config, so dropping
 * `noctcore-prisma/no-raw-sql-outside-allowlist` from `packages/eslint-config/nestjs.js`
 * fails the control rather than quietly emptying the other case.
 *
 * The two type-aware promise rules are turned off for these lint calls only:
 * the control lints a fixture that exists in no TypeScript program, and they
 * would throw rather than report. The rule under test is syntactic, so nothing
 * it needs is lost.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ESLint } from 'eslint';

const RULE_ID = 'noctcore-prisma/no-raw-sql-outside-allowlist';
const API_ROOT = resolve(__dirname, '..');
const SRC_ROOT = join(API_ROOT, 'src');
const SKIP_DIRS = new Set(['node_modules', 'dist', '@generated', '.turbo', 'coverage']);

/** Anything the rule looks at. Cheap pre-filter so the lint call stays small. */
const RAW_SQL_MARKER =
  /\$(?:query|execute)Raw(?:Unsafe|Typed)?|Prisma\s*\.\s*(?:raw|sql|join|empty)/u;

function collectSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSource(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * ESLint with the api's own flat config, minus every type-aware rule.
 * `overrideConfig` is appended last, so everything else (the block that wires
 * the rule under test) still applies exactly as `pnpm lint` resolves it.
 *
 * The control lints a fixture that exists in no TypeScript program, so a rule
 * needing type information does not merely skip it, it THROWS while loading and
 * takes the whole file's evidence with it. Any rule added to the api's
 * `projectService` block has to be switched off here too.
 */
const eslint = new ESLint({
  cwd: API_ROOT,
  overrideConfig: {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: false, project: null } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      'noctcore-prisma/mutation-entry-must-reach-audit': 'off',
    },
  },
});

interface IReport {
  readonly file: string;
  readonly message: string;
}

const rawSqlReports = (results: readonly ESLint.LintResult[]): IReport[] =>
  results.flatMap((result) =>
    result.messages
      .filter((message) => message.ruleId === RULE_ID && message.severity === 2)
      .map((message) => ({ file: relative(API_ROOT, result.filePath), message: message.message })),
  );

/** An unguarded raw read with string interpolation: the exact door the rule exists for. */
const LEAKY_FIXTURE = [
  "import type { PrismaService } from '../../common/database/prisma.service';",
  'export class LeakyRepository {',
  '  constructor(private readonly prismaService: PrismaService) {}',
  '  async all(id: string): Promise<unknown> {',
  '    return this.prismaService.client.$queryRawUnsafe(',
  '      `SELECT * FROM "User" WHERE id = \'${id}\'`,',
  '    );',
  '  }',
  '}',
  '',
].join('\n');

describe('SEC-005 raw SQL never leaves the allowlist', () => {
  it('control: the resolved config reports an unguarded raw query in a fixture', async () => {
    // Without this, the tree case below would also pass against a config that
    // had lost the rule entirely, which is precisely how this finding would
    // come back.
    const results = await eslint.lintText(LEAKY_FIXTURE, {
      filePath: join(SRC_ROOT, 'modules', 'user', 'leaky.repository.ts'),
    });

    expect(rawSqlReports(results)).toHaveLength(1);
  });

  it('no file under src uses raw SQL outside the allowlist', async () => {
    const candidates = collectSource(SRC_ROOT).filter((file) =>
      RAW_SQL_MARKER.test(readFileSync(file, 'utf8')),
    );

    // The pre-filter has to find the raw queries this repo does have (the
    // advisory locks), or "no reports" would just mean "nothing was linted".
    expect(candidates.length).toBeGreaterThan(0);
    expect(rawSqlReports(await eslint.lintFiles(candidates))).toEqual([]);
  }, 60_000);
});

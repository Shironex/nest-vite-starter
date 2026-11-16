import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Raw SQL is an unreviewed door past every model-level guard. The soft-delete
 * filters, the select allowlists and the parameter binding of the query builder
 * all live on the Prisma MODEL, and a raw query has none, so `$queryRaw` /
 * `$executeRaw` (and above all the `Unsafe` variants) skip them and type-check
 * anyway. The guard is a lint rule with an allowlist, pinned at error.
 *
 * What regresses is not a function but the tree: a new raw query nobody
 * allowlisted, or the rule quietly dropped from `packages/eslint-config/nestjs.js`.
 * Both directions are checked against the RESOLVED api config, so losing the
 * rule fails the control rather than emptying the tree case.
 *
 * ESLint runs in a child process because the flat config is ESM and the fast
 * jest lane has no VM modules. The type-aware rules are switched off for these
 * lint calls only: the control lints a fixture that exists in no TypeScript
 * program, and they would throw rather than report. The rule under test is
 * syntactic, so nothing it needs is lost.
 */
const RULE_ID = 'noctcore-prisma/no-raw-sql-outside-allowlist';
const API_ROOT = join(__dirname, '..', '..', '..');
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
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

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

interface IReport {
  readonly file: string;
  readonly message: string;
}

interface ILintOutcome {
  readonly fixture: IReport[];
  readonly tree: IReport[];
}

const lint = (fixturePath: string, candidates: string[]): ILintOutcome => {
  const script = `
    import { ESLint } from 'eslint';
    import { relative } from 'node:path';
    const [ruleId, fixturePath, fixture, candidatesJson] = process.argv.slice(1);
    const eslint = new ESLint({
      cwd: process.cwd(),
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
    const reports = (results) =>
      results.flatMap((result) =>
        result.messages
          .filter((m) => m.ruleId === ruleId && m.severity === 2)
          .map((m) => ({ file: relative(process.cwd(), result.filePath), message: m.message })),
      );
    const fixtureResults = await eslint.lintText(fixture, { filePath: fixturePath });
    const treeResults = await eslint.lintFiles(JSON.parse(candidatesJson));
    process.stdout.write(JSON.stringify({ fixture: reports(fixtureResults), tree: reports(treeResults) }));
  `;
  const stdout = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      script,
      RULE_ID,
      fixturePath,
      LEAKY_FIXTURE,
      JSON.stringify(candidates),
    ],
    { cwd: API_ROOT, encoding: 'utf8', timeout: 90_000 },
  );
  return JSON.parse(stdout) as ILintOutcome;
};

describe('raw SQL never leaves the allowlist', () => {
  let candidates: string[];
  let outcome: ILintOutcome;

  beforeAll(() => {
    candidates = collectSource(SRC_ROOT).filter((file) =>
      RAW_SQL_MARKER.test(readFileSync(file, 'utf8')),
    );
    outcome = lint(join(SRC_ROOT, 'modules', 'user', 'leaky.repository.ts'), candidates);
  }, 120_000);

  it('control: the resolved config reports an unguarded raw query in a fixture', () => {
    // Without this, the tree case below would also pass against a config that
    // had lost the rule entirely, which is precisely how this would come back.
    expect(outcome.fixture).toHaveLength(1);
  });

  it('finds the raw queries this repo does have, so the tree case lints something', () => {
    // The advisory locks. Otherwise "no reports" would just mean "nothing was linted".
    expect(candidates.map((file) => relative(API_ROOT, file)).length).toBeGreaterThan(0);
  });

  it('no file under src uses raw SQL outside the allowlist', () => {
    expect(outcome.tree).toEqual([]);
  });
});

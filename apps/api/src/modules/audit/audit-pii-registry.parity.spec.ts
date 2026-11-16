import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { AUDIT_PII_FIELDS } from '@repo/shared/audit';
import { AUDIT_PII_PAYLOAD_COLUMNS } from './audit-pii-scrub.service';

/**
 * The audit PII registry has two readers: `observability/audit-pii-declared`
 * (its `registeredFields` in packages/eslint-config/nestjs.js) and the purge
 * scrub (AUDIT_PII_FIELDS in @repo/shared/audit). A key declared to the rule but
 * missing from the shared list LINTS CLEAN AND IS NEVER ERASED, which is the one
 * failure this policy exists to prevent.
 *
 * Both now read `packages/shared/src/audit/pii-fields.json`, so this no longer
 * catches two hand-kept copies drifting: there is one copy. What it checks
 * instead is that the READ still works and still reaches the rule. That is the
 * live failure mode now. The file can move, the relative path in the config can
 * go stale, the JSON shape can change, or a preset can stop passing the option
 * along, and any of those silently hands the rule a list that is not the one the
 * scrub erases. Dropping a key is caught more directly and sooner: the audit
 * write using it stops being declared and lint reds on that line.
 *
 * Read through the REAL ESLint config resolution for real api files, not by
 * importing the config module's internals: that is what actually applies when
 * lint runs, including the per-file override for the opaque-payload files. A
 * child process because the config is ESM and the fast jest lane has no VM
 * modules.
 */
const API_ROOT = join(__dirname, '..', '..', '..');
const RULE = 'observability/audit-pii-declared';

/** The default payload keys of the rule, used when the config sets none. */
const RULE_DEFAULT_PAYLOAD_KEYS = ['metadata', 'before', 'after'];

const PROBED_FILES = [
  // An ordinary audit writer: the email-change flow that writes both keys.
  'src/modules/auth/services/email-change.service.ts',
  // The purge itself.
  'src/modules/user/user-purge.service.ts',
];

interface IResolvedRule {
  file: string;
  entry: unknown;
}

const resolveRuleConfigs = (): IResolvedRule[] => {
  const script = `
    import { ESLint } from 'eslint';
    const eslint = new ESLint({ cwd: process.cwd() });
    const files = JSON.parse(process.argv[1]);
    const out = [];
    for (const file of files) {
      const config = await eslint.calculateConfigForFile(file);
      out.push({ file, entry: config.rules?.[${JSON.stringify(RULE)}] ?? null });
    }
    process.stdout.write(JSON.stringify(out));
  `;
  const stdout = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script, JSON.stringify(PROBED_FILES)],
    { cwd: API_ROOT, encoding: 'utf8', timeout: 60_000 },
  );
  return JSON.parse(stdout) as IResolvedRule[];
};

describe('audit PII registry parity (lint rule <-> purge scrub)', () => {
  let resolved: IResolvedRule[];

  beforeAll(() => {
    resolved = resolveRuleConfigs();
  }, 90_000);

  it('resolves the rule for every probed file', () => {
    expect(resolved.map((r) => r.file)).toEqual(PROBED_FILES);
  });

  it.each(PROBED_FILES)('%s: the rule is at error with exactly the scrubbed fields', (file) => {
    const entry = resolved.find((r) => r.file === file)?.entry;
    expect(Array.isArray(entry)).toBe(true);
    const [severity, options] = entry as [number, Record<string, unknown> | undefined];
    // 2 is "error": a registry the rule only warns about is a registry nobody reads.
    expect(severity).toBe(2);
    const registered = options?.registeredFields;
    expect([...((registered as string[] | undefined) ?? [])].sort()).toEqual(
      [...AUDIT_PII_FIELDS].sort(),
    );
  });

  it.each(PROBED_FILES)('%s: the rule inspects exactly the columns the scrub rewrites', (file) => {
    const entry = resolved.find((r) => r.file === file)?.entry as
      [number, Record<string, unknown> | undefined] | undefined;
    const payloadKeys =
      (entry?.[1]?.payloadKeys as string[] | undefined) ?? RULE_DEFAULT_PAYLOAD_KEYS;
    expect([...payloadKeys].sort()).toEqual([...AUDIT_PII_PAYLOAD_COLUMNS].sort());
  });
});

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail, repoRoot, toKebab, writeNew } from './codegen-utils';

/*
 * `pnpm new:finding <id> <slug> [issue]`: scaffold one security finding.
 *
 * It writes the spec AND its manifest row together, because the pair is the
 * unit: a spec with no row runs unlisted, a row with no spec never runs, and
 * `pnpm check:security` fails on either. Doing it by hand is how they drift.
 *
 * The scaffold is deliberately RED, as infrastructure: every case throws
 * `specPrecondition`, so the reconciler records it `blocked` (never as evidence
 * for or against the finding) and the gate stays red until somebody writes the
 * test. A scaffold that passed would be a finding that looks covered and is
 * not, which is the state this whole lane exists to end.
 *
 *   pnpm new:finding SEC-007 session-epoch-fence      # issue number optional
 */

const ID_PATTERN = /^SEC-\d{3}$/u;
const MANIFEST_PATH = 'apps/api/security-spec/findings.json';

const [rawId, rawSlug, rawIssue] = process.argv.slice(2);

if (rawId === undefined || rawSlug === undefined) {
  fail('usage: pnpm new:finding <id> <slug> [issue]   e.g. SEC-007 session-epoch-fence');
}
if (!ID_PATTERN.test(rawId)) {
  fail(`id must look like SEC-007 (SEC- and a three digit ordinal); got "${rawId}"`);
}

const issue = rawIssue === undefined ? undefined : Number(rawIssue);
if (issue !== undefined && (!Number.isInteger(issue) || issue <= 0)) {
  fail(`issue, when given, must be an issue number; got "${String(rawIssue)}"`);
}
const issueNote = issue === undefined ? '' : ` (issue ${String(issue)})`;

const slug = toKebab(rawSlug);
const specRelative = `security-spec/${slug}.security-spec.ts`;
const specPath = `apps/api/${specRelative}`;
const suite = `${rawId} <one line: the invariant this finding is about>`;
const controlCase = 'control: <the thing that proves the code under test is reached at all>';
const findingCase = '<the refusal, the absence or the guard this finding is about>';

interface IManifestDocument {
  version: number;
  findings: {
    id: string;
    issue?: number;
    title: string;
    status: string;
    spec: string;
    cases: { name: string; expect: string }[];
  }[];
}

const manifestAbsolute = join(repoRoot, MANIFEST_PATH);
const manifest = JSON.parse(readFileSync(manifestAbsolute, 'utf8')) as IManifestDocument;

if (manifest.findings.some((finding) => finding.id === rawId)) {
  fail(`finding "${rawId}" is already in ${MANIFEST_PATH}`);
}

writeNew(specPath, specSource());

manifest.findings.push({
  id: rawId,
  ...(issue === undefined ? {} : { issue }),
  title: `TODO: the finding, in one line${issueNote}`,
  status: 'proven',
  spec: specRelative,
  cases: [
    { name: `${suite} > ${controlCase}`, expect: 'pass' },
    { name: `${suite} > ${findingCase}`, expect: 'fail' },
  ],
});

writeFileSync(manifestAbsolute, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`  updated  ${MANIFEST_PATH}`);

console.log(`\n  ${rawId} scaffolded, and RED as infrastructure until you write it.`);
console.log('  1. Write the cases. Watch the finding case FAIL against the unfixed code first.');
console.log('  2. Rename the suite and the cases, and copy the new names into findings.json.');
console.log('  3. Once the fix lands: status -> "fixed", the case -> "pass", describe the fix.');
console.log(`\n    export DATABASE_URL=<a real database> && pnpm check:security\n`);

function specSource(): string {
  return `/**
 * ${rawId}${issueNote}: <what the finding is, in one paragraph>.
 *
 * <Why the ordinary suites cannot see it: what they mock, what only real rows
 * or a real race can show.>
 *
 * Status: proven, not yet fixed. Write the finding case so it FAILS against the
 * current code before anything is changed, and describe the fix here when it
 * lands.
 */
import { specPrecondition } from './harness';

/**
 * Every case below fails as INFRASTRUCTURE until this spec is written, so the
 * reconciler records it as \`blocked\` rather than as evidence. Named
 * \`expect...\` so \`security-spec-no-silent-bail\` can see the assertion.
 */
const expectWritten = (): never =>
  specPrecondition('${rawId} has no test yet. Write the cases in ${specRelative}.');

describe('${suite}', () => {
  it('${controlCase}', () => {
    expectWritten();
  });

  it('${findingCase}', () => {
    expectWritten();
  });
});
`;
}

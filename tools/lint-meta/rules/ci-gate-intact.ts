import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';

import { LANES } from '../../verify/lanes';

const RULE_ID = 'ci-gate-intact';
const CI = '.github/workflows/ci.yml';
const WORKFLOWS = '.github/workflows/*.{yml,yaml}';

/** A YAML line with its comment removed (a `#` at the start or after whitespace). */
function stripComment(line: string): string {
  return line.replace(/(^|\s)#.*$/u, '$1').trimEnd();
}

/** The lane ids one `pnpm verify` invocation runs: every lane when none is named. */
function lanesOf(invocation: string): string[] {
  const named = [...invocation.matchAll(/--lane=(\S+)/gu)].flatMap((match) =>
    (match[1] ?? '').split(','),
  );
  return named.length === 0 ? LANES.map((lane) => lane.id) : named;
}

export function checkCiGateIntact(ctx: IMetaCtx): IViolation[] {
  const violations: IViolation[] = [];
  const report = (file: string, message: string): void => {
    violations.push({ file, rule: RULE_ID, message });
  };

  const ci = ctx.read(CI);
  if (ci === null) {
    return [
      { file: CI, rule: RULE_ID, message: `${CI} is missing, so nothing gates a pull request.` },
    ];
  }
  const lines = ci.split('\n').map(stripComment);

  if (!lines.some((line) => /\bpull_request\b/u.test(line))) {
    report(CI, 'ci.yml no longer runs on pull_request, so a PR merges ungated.');
  }

  const invocations = lines
    .map((line) => /\bpnpm\s+verify\b(.*)$/u.exec(line)?.[1])
    .filter((rest): rest is string => rest !== undefined);
  for (const rest of invocations) {
    if (/--affected\b/u.test(rest)) {
      report(
        CI,
        `"pnpm verify${rest}" uses --affected in CI, which skips unchanged packages. CI runs every package.`,
      );
    }
  }
  const covered = new Set(invocations.flatMap(lanesOf));
  for (const lane of LANES) {
    if (!covered.has(lane.id)) {
      report(
        CI,
        `ci.yml never runs the "${lane.id}" lane. Add a "pnpm verify --lane=${lane.id}" step to the check job.`,
      );
    }
  }

  for (const file of ctx.glob(WORKFLOWS).sort()) {
    const text = ctx.read(file) ?? '';
    text.split('\n').forEach((raw, index) => {
      if (/^\s*continue-on-error\s*:\s*(?:true|['"]true['"]|\$\{\{)/u.test(stripComment(raw))) {
        report(
          file,
          `Line ${String(index + 1)}: continue-on-error lets a failing step pass the job. Fix the step or remove it.`,
        );
      }
    });
  }

  return violations;
}

/** CI still runs every verify lane on pull requests, and no step may fail softly. */
export const ciGateIntactRule: IMetaRule = {
  id: RULE_ID,
  category: 'ci',
  ciCritical: true,
  description:
    'ci.yml runs on pull_request and runs every verify lane (never with --affected), and no workflow step uses continue-on-error.',
  run: checkCiGateIntact,
};

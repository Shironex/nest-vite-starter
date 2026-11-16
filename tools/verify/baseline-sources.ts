/*
 * Where the baseline's keys come from.
 *
 * `pnpm verify` records a STATUS per check, which is the right shape for a gate
 * and the wrong shape for a diff: "lint failed" cannot be subtracted from "lint
 * failed". So the differential gate re-runs the four checks that can name their
 * violations and reads the names out of their output.
 *
 * Re-running is cheap on purpose. `turbo lint` and `turbo check-types` are
 * cached tasks, so the second run replays the first run's logs in a second or
 * two; `lint:meta` is a few seconds; the test keys come from the JUnit each
 * runner already wrote for the committed inventory, so no suite runs twice.
 *
 * Every parser here fails CLOSED. A command that exited non-zero while its
 * parser found nothing is `blocked`, not "no violations", and a turbo task that
 * turbo itself reports as failed has to be accounted for by at least one parsed
 * finding, or the whole source is blocked and names the task. That matters
 * because not every check speaks a format this file reads (a workspace may
 * print any compiler format), and a gate that silently skips what it cannot parse would
 * grade a lane green on exactly the failures nobody was watching.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IJUnitCase } from '../quality/junit';
import { parseJUnit } from '../quality/junit';
import type {
  FindingKind,
  ICollection,
  ICountedFinding,
  IFinding,
  ISourceRecord,
} from './baseline';
import { tallyFindings, totalFindings } from './baseline';
import { run } from './exec';
import { treeFingerprint } from './fingerprint';
import { isSyntheticCase, normalizeFile, normalizeTitle } from './inventory';
import { INVENTORY_SUITES } from './inventory-suites';

/* Text handling shared by the parsers. */

// Built from a char code rather than written as an escape: the pattern holds a
// control character, which ESLint's no-control-regex rejects in a literal.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'gu');

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

export interface IPrefixedLine {
  /** The turbo task that printed it (`@repo/api:lint`), or null for turbo's own output. */
  readonly label: string | null;
  readonly text: string;
}

/**
 * Split turbo's interleaved output back into the tasks that produced it.
 *
 * turbo prefixes every line of a child with `<package>:<task>: `, including the
 * lines it replays from its cache. Task names hold colons of their own
 * (`nest-vite-saas-starter:check-types:tools:`) but never a space, so the prefix is everything
 * up to the first `": "` when that head has no whitespace in it.
 */
export function splitTurboLines(output: string): readonly IPrefixedLine[] {
  return stripAnsi(output)
    .split('\n')
    .map((line) => {
      const split = line.indexOf(': ');
      const head = split === -1 ? '' : line.slice(0, split);
      if (split === -1 || head === '' || /\s/u.test(head) || !head.includes(':')) {
        return { label: null, text: line };
      }
      return { label: head, text: line.slice(split + 2) };
    });
}

/** `@repo/api:lint` -> `@repo/api`. */
export function packageOfLabel(label: string | null): string | null {
  if (label === null) {
    return null;
  }
  const colon = label.indexOf(':');
  return colon === -1 ? label : label.slice(0, colon);
}

/**
 * The tasks turbo says failed, as `package#task`.
 *
 * This is the cross-check that keeps an unparsed format from reading as clean:
 * every failed task has to be explained by a finding, whoever printed it.
 */
export function parseTurboFailures(output: string): readonly string[] {
  const failures = new Set<string>();
  for (const line of stripAnsi(output).split('\n')) {
    const match = /^\s*Failed:\s*(.+)$/u.exec(line);
    if (match?.[1] !== undefined) {
      for (const task of match[1].split(/[,\s]+/u)) {
        if (task !== '') {
          failures.add(task);
        }
      }
    }
  }
  return [...failures];
}

/** Repo-relative, POSIX separators, for a path a tool printed. */
export function toRepoRelative(root: string, file: string, packageDir: string): string {
  const posix = file.replace(/\\/gu, '/').replace(/^\.\//u, '');
  const rootPosix = root.replace(/\\/gu, '/').replace(/\/+$/u, '');
  if (posix.startsWith(`${rootPosix}/`)) {
    return posix.slice(rootPosix.length + 1);
  }
  if (posix.startsWith('/') || packageDir === '') {
    return posix;
  }
  return `${packageDir}/${posix}`;
}

/* ESLint. `eslint .` in every package, through turbo, default stylish output. */

const ESLINT_PROBLEM = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/u;
const ESLINT_SUMMARY = /^\s*[^\s]?\s*(\d+) problems?\s*\(/u;

export interface ISourceParse {
  readonly findings: readonly IFinding[];
  /** Why the output cannot be trusted, or null. */
  readonly blocked: string | null;
}

export interface IParseContext {
  readonly root: string;
  /** Package name -> repo-relative directory, for the tools that print package-relative paths. */
  readonly packageDirs: ReadonlyMap<string, string>;
  readonly exitCode: number;
}

function packageDirOf(context: IParseContext, label: string | null): string {
  const name = packageOfLabel(label);
  return name === null ? '' : (context.packageDirs.get(name) ?? '');
}

/**
 * ESLint's stylish output: a bare file path, then one indented
 * `line:col severity message rule-id` per problem, then a `N problems` summary.
 *
 * The summary is the cross-check. ESLint counts its own problems, so a parser
 * that read fewer (a message wrapped over two lines, a formatter someone
 * changed) is caught here instead of silently shrinking the baseline.
 */
export function parseEslintOutput(output: string, context: IParseContext): ISourceParse {
  const findings: IFinding[] = [];
  let reported = 0;
  let file: string | null = null;
  let label: string | null = null;

  for (const line of splitTurboLines(output)) {
    if (line.label !== label) {
      label = line.label;
      file = null;
    }
    const summary = ESLINT_SUMMARY.exec(line.text);
    if (summary?.[1] !== undefined && line.text.includes('problem')) {
      reported += Number(summary[1]);
      file = null;
      continue;
    }
    const problem = ESLINT_PROBLEM.exec(line.text);
    if (problem !== null && file !== null) {
      findings.push({
        kind: 'eslint',
        file,
        rule: problem[5] ?? '',
        message: normalizeTitle(problem[4] ?? '', context.root),
      });
      continue;
    }
    if (/^(?:\/|[A-Za-z]:[\\/])/u.test(line.text.trim()) && !line.text.startsWith(' ')) {
      file = toRepoRelative(context.root, line.text.trim(), packageDirOf(context, line.label));
    }
  }

  return { findings, blocked: eslintBlocked(output, findings, reported, context) };
}

function eslintBlocked(
  output: string,
  findings: readonly IFinding[],
  reported: number,
  context: IParseContext,
): string | null {
  if (reported !== findings.length) {
    return `ESLint reported ${String(reported)} problem(s), this parser read ${String(findings.length)}`;
  }
  return unexplainedFailures('lint', output, findings, context);
}

/**
 * Any turbo task that failed without leaving a finding behind, plus the case
 * where the command failed and nothing parsed at all.
 */
function unexplainedFailures(
  task: string,
  output: string,
  findings: readonly IFinding[],
  context: IParseContext,
): string | null {
  const blamed = new Set(findings.map((finding) => finding.file.split('/').slice(0, 2).join('/')));
  const unexplained = parseTurboFailures(output).filter((failed) => {
    const name = failed.split('#')[0] ?? '';
    const dir = context.packageDirs.get(name);
    return dir === undefined || dir === '' ? findings.length === 0 : !blamed.has(dir);
  });
  if (unexplained.length > 0) {
    return `turbo reports ${unexplained.join(', ')} failed, and no ${task} finding explains it`;
  }
  if (context.exitCode !== 0 && findings.length === 0) {
    return `the command exited ${String(context.exitCode)} and nothing parsed as a violation`;
  }
  return null;
}

/* tsc. Package-relative paths, and no line or column in the key. */

const TSC_DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): (?:error|warning) (TS\d+): (.*)$/u;
const TSC_GLOBAL = /^(?:error|warning) (TS\d+): (.*)$/u;

export function parseTscOutput(output: string, context: IParseContext): ISourceParse {
  const findings: IFinding[] = [];

  for (const line of splitTurboLines(output)) {
    const diagnostic = TSC_DIAGNOSTIC.exec(line.text);
    if (diagnostic !== null) {
      findings.push({
        kind: 'tsc',
        file: toRepoRelative(context.root, diagnostic[1] ?? '', packageDirOf(context, line.label)),
        rule: diagnostic[4] ?? '',
        message: normalizeTitle(diagnostic[5] ?? '', context.root),
      });
      continue;
    }
    const global = TSC_GLOBAL.exec(line.text);
    if (global !== null) {
      findings.push({
        kind: 'tsc',
        file: '(global)',
        rule: global[1] ?? '',
        message: normalizeTitle(global[2] ?? '', context.root),
      });
    }
  }

  return { findings, blocked: unexplainedFailures('type', output, findings, context) };
}

/*
 * lint:meta, which is `harness lint-meta` (@noctcore/harness). One line per
 * violation, `[ERROR] <rule> (<file>): <message>` (`[info]` for a rule that is
 * not ciCritical, which tools/lint-meta/registry.ts refuses to load), and
 * `[ERROR] <rule>: rule threw|rejected \u2014 <why>` for a rule that broke. The
 * reporter prints no count, so a format change is caught two ways instead: a
 * tagged line this parser cannot read, and a failing exit that read nothing.
 */

const META_VIOLATION = /^\[(?:ERROR|info)\] ([\w-]+) \((.+?)\): (.*)$/u;
const META_BROKEN = /^\[ERROR\] ([\w-]+): rule (?:threw|rejected) \u2014 (.*)$/u;
const META_TAGGED = /^\[(?:ERROR|info)\] /u;

export function parseLintMetaOutput(output: string, context: IParseContext): ISourceParse {
  const findings: IFinding[] = [];
  const broken: string[] = [];
  const unread: string[] = [];

  for (const raw of stripAnsi(output).split('\n')) {
    const line = raw.trimEnd();
    const brokenRule = META_BROKEN.exec(line);
    if (brokenRule !== null) {
      broken.push(`${brokenRule[1] ?? ''} (${brokenRule[2] ?? ''})`);
      continue;
    }
    const violation = META_VIOLATION.exec(line);
    if (violation !== null) {
      findings.push({
        kind: 'lint-meta',
        file: toRepoRelative(context.root, violation[2] ?? '', ''),
        rule: violation[1] ?? '',
        message: normalizeTitle(violation[3] ?? '', context.root),
      });
      continue;
    }
    if (META_TAGGED.test(line)) {
      unread.push(line);
    }
  }

  // A rule that threw checked nothing, so the findings it would have made are unknown.
  if (broken.length > 0) {
    return { findings, blocked: `lint:meta rule(s) threw: ${broken.join(', ')}` };
  }
  if (unread.length > 0) {
    return {
      findings,
      blocked: `lint:meta printed ${String(unread.length)} line(s) this parser cannot read, first: ${unread[0] ?? ''}`,
    };
  }
  return {
    findings,
    blocked:
      context.exitCode !== 0 && findings.length === 0
        ? `lint:meta exited ${String(context.exitCode)} without printing a violation`
        : null,
  };
}

/* Tests. The keys come from the JUnit the inventory already collects. */

function testFindings(cases: readonly IJUnitCase[], pathBase: string, root: string): IFinding[] {
  return cases
    .map((testCase) => ({
      file: normalizeFile(testCase.file, pathBase),
      fullName: normalizeTitle(testCase.name, root),
      status: testCase.status,
    }))
    .filter((observed) => observed.status !== 'passed' && !isSyntheticCase(observed.fullName))
    .map((observed) => ({
      kind: 'test' as FindingKind,
      file: observed.file,
      rule: observed.status,
      message: observed.fullName,
    }));
}

/*
 * Only cases that did NOT pass become keys. Which cases exist at all is already
 * the committed inventory's job (`pnpm verify:inventory`), and duplicating it
 * here would mean two baselines to keep in step, disagreeing on the day someone
 * accepts one of them.
 */
export function collectTestFindings(root: string): ISourceParse {
  const findings: IFinding[] = [];
  const missing: string[] = [];

  for (const suite of INVENTORY_SUITES) {
    const report = join(root, suite.report);
    if (!existsSync(report)) {
      if (suite.required) {
        missing.push(suite.id);
      }
      continue;
    }
    const cases = parseJUnit(readFileSync(report, 'utf8'));
    if (cases.length === 0) {
      missing.push(`${suite.id} (report holds no case)`);
      continue;
    }
    findings.push(...testFindings(cases, suite.pathBase, root));
  }

  return {
    findings,
    blocked:
      missing.length === 0
        ? null
        : `no test report for ${missing.join(', ')}; run the suites (\`pnpm verify --profile=feature\`) first`,
  };
}

/* The sources, and running them. */

export interface ISourceSpec {
  readonly id: string;
  readonly kind: FindingKind;
  /** argv from the repo root, or null for a source that reads reports. */
  readonly command: readonly string[] | null;
  readonly parse: (output: string, context: IParseContext) => ISourceParse;
}

export const SOURCES: readonly ISourceSpec[] = [
  {
    id: 'eslint',
    kind: 'eslint',
    command: ['pnpm', 'exec', 'turbo', 'lint'],
    parse: parseEslintOutput,
  },
  {
    id: 'tsc',
    kind: 'tsc',
    command: ['pnpm', 'exec', 'turbo', 'check-types'],
    parse: parseTscOutput,
  },
  {
    id: 'lint-meta',
    kind: 'lint-meta',
    command: ['pnpm', 'lint:meta'],
    parse: parseLintMetaOutput,
  },
  {
    id: 'test',
    kind: 'test',
    command: null,
    parse: () => ({ findings: [], blocked: 'unreachable: the test source reads reports' }),
  },
];

/** Package name -> repo-relative directory, read from the workspace itself. */
export function packageDirs(root: string): ReadonlyMap<string, string> {
  const dirs = new Map<string, string>();
  const readName = (relative: string): void => {
    const manifest = join(root, relative, 'package.json');
    if (!existsSync(manifest)) {
      return;
    }
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
    const name = (parsed as { name?: unknown }).name;
    if (typeof name === 'string') {
      dirs.set(name, relative);
    }
  };

  readName('');
  for (const group of ['apps', 'packages']) {
    const dir = join(root, group);
    if (!existsSync(dir)) {
      continue;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        readName(`${group}/${entry.name}`);
      }
    }
  }
  return dirs;
}

export interface ICollectOptions {
  readonly root: string;
  readonly log: (message: string) => void;
  /** Run only these sources. Default: all of them. */
  readonly only?: readonly string[];
}

export interface ISourceOutcome {
  readonly record: ISourceRecord;
  readonly findings: readonly IFinding[];
}

export function runSource(
  source: ISourceSpec,
  root: string,
  dirs: ReadonlyMap<string, string>,
): ISourceOutcome {
  if (source.command === null) {
    const parsed = collectTestFindings(root);
    return { record: recordOf(source.id, parsed), findings: parsed.findings };
  }

  // NO_COLOR keeps the parsers looking at text rather than at escape codes, and
  // turbo's own TUI is already off because stdout here is a pipe, not a tty.
  const result = run(source.command[0] ?? '', source.command.slice(1), {
    cwd: root,
    env: { NO_COLOR: '1', FORCE_COLOR: '0' },
    inheritEnv: true,
  });
  if (result.status === 127) {
    return {
      record: {
        id: source.id,
        status: 'blocked',
        reason: `command_unavailable (${source.command.join(' ')})`,
        count: 0,
      },
      findings: [],
    };
  }

  const parsed = source.parse(`${result.stdout}\n${result.stderr}`, {
    root,
    packageDirs: dirs,
    exitCode: result.status,
  });
  return { record: recordOf(source.id, parsed), findings: parsed.findings };
}

function recordOf(id: string, parsed: ISourceParse): ISourceRecord {
  return parsed.blocked === null
    ? {
        id,
        status: 'collected',
        reason: `${String(parsed.findings.length)} finding(s)`,
        count: parsed.findings.length,
      }
    : { id, status: 'blocked', reason: parsed.blocked, count: 0 };
}

/** Run every source over the tree at `root` and fold the result into a collection. */
export function collect(options: ICollectOptions): ICollection {
  const dirs = packageDirs(options.root);
  const findings: IFinding[] = [];
  const sources: ISourceRecord[] = [];

  for (const source of SOURCES) {
    if (options.only !== undefined && !options.only.includes(source.id)) {
      continue;
    }
    options.log(`▶ ${source.id}`);
    const outcome = runSource(source, options.root, dirs);
    options.log(`  ${outcome.record.status}: ${outcome.record.reason}`);
    sources.push(outcome.record);
    findings.push(...outcome.findings);
  }

  const tree = treeFingerprint(options.root);
  const counted: readonly ICountedFinding[] = tallyFindings(findings);
  options.log(
    `collected ${String(totalFindings(counted))} finding(s) over ${String(counted.length)} key(s)`,
  );
  return {
    commit: tree.commit,
    fingerprint: tree.fingerprint,
    findings: counted,
    sources,
  };
}

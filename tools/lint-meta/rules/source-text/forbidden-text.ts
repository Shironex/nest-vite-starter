import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

import ts from 'typescript';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

/*
 * Generated output legitimately carries blanket suppressions: TanStack's
 * routeTree.gen.ts and codegen banners disable linting for the whole file.
 * Skip generated files so the ban applies only to hand-written source.
 */
export function isGenerated(file: string): boolean {
  return (
    /\.gen\.tsx?$/u.test(basename(file)) ||
    file.includes('/@generated/') ||
    file.includes('/generated/')
  );
}

export const INLINE_DISABLE = /\beslint-disable(?:-next-line|-line)?\b/u;
export const TS_SUPPRESSION = /@ts-(?:ignore|expect-error)\b/u;

/*
 * The same two patterns anchored to the START of a comment, which is the only
 * place ESLint and TypeScript honor them.
 *
 * The unanchored patterns above are a cheap pre-filter (and what the edit hook
 * counts, where over-eagerness at write time costs nothing). They cannot be the
 * answer on their own: since lint-meta scans `tools/` these rules read their own
 * source, where the directives appear as regex patterns, as message text, as
 * prose in a doc comment and as fixture strings in a rule test. Every one of
 * those is data, and reporting them would be the rule mistaking its own
 * definition for a violation.
 */
const INLINE_DISABLE_DIRECTIVE = /^eslint-disable(?:-next-line|-line)?\b/u;
const TS_SUPPRESSION_DIRECTIVE = /^@ts-(?:ignore|expect-error)\b/u;

export const INLINE_DISABLE_MESSAGE =
  'Inline eslint-disable is not allowed. Fix the rule violation, or add a scoped override to eslint config (a generated-file path is exempt).';
export const TS_SUPPRESSION_MESSAGE =
  'TypeScript suppression comments are not allowed. Narrow the type or fix the underlying error.';

/** A comment token with its opener, closer and surrounding whitespace removed. */
function commentBody(token: string): string {
  const inner = token.startsWith('//')
    ? token.slice(2)
    : token.slice(2, token.endsWith('*/') ? -2 : undefined);
  return inner.trim();
}

/**
 * Whether any comment in `source` OPENS with `directive`.
 *
 * ESLint and TypeScript both read a directive off the trimmed comment body, so a
 * block comment whose first line is `eslint-disable` counts while a doc comment
 * that mentions one in passing does not. Scanning trivia (rather than the raw
 * text) is also what keeps a string literal holding a fixture out of the answer.
 */
export function hasDirectiveComment(source: string, directive: RegExp, file: string): boolean {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    extname(file) === '.tsx' ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    source,
  );

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue;
    }
    if (directive.test(commentBody(scanner.getTokenText()))) {
      return true;
    }
  }

  return false;
}

/**
 * `source` with every comment and string body blanked out, offsets preserved.
 *
 * The dual of `hasDirectiveComment`. A suppression counts only where it OPENS a
 * comment; a forbidden call counts only where it is CODE. Both exist for the
 * same reason: lint-meta scans `tools/`, so a rule reads its own source, where
 * the text it bans appears in its pattern, in its message and in prose. All of
 * that is data, and reporting it would be the rule mistaking its own definition
 * for a violation.
 *
 * Blanking rather than deleting keeps every offset, so a pattern can still span
 * tokens (`BullModule` `.` `registerQueue` `(`) without gluing together text
 * that a comment used to separate.
 */
export function codeOnlySource(source: string, file: string): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    extname(file) === '.tsx' ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    source,
  );
  const out = source.split('');

  const blanked = new Set([
    ts.SyntaxKind.SingleLineCommentTrivia,
    ts.SyntaxKind.MultiLineCommentTrivia,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
  ]);

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (!blanked.has(token)) {
      continue;
    }
    // Keep newlines so a blanked block comment cannot merge the lines around it.
    for (let i = scanner.getTokenStart(); i < scanner.getTokenEnd(); i += 1) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  }

  return out.join('');
}

/**
 * Where a match has to sit to count.
 *
 * `comment-directive`: the text must OPEN a comment (`directive` says which).
 * `code`: the text must survive `codeOnlySource`.
 */
type Locator = { kind: 'comment-directive'; directive: RegExp } | { kind: 'code' };

/**
 * Read a file from a path list that was globbed earlier, or null if it has since
 * gone.
 *
 * `sourceFiles` is a SNAPSHOT. By the time a rule reads it the tree may have
 * moved, so a plain `readFileSync` can throw ENOENT for a file that is simply no
 * longer there. That is not a rule failure and it is not a violation: a file
 * that does not exist cannot contain forbidden text.
 *
 * This is not hypothetical. `pnpm test:lint-meta` runs the codegen test, which
 * invokes `lint:meta`, at the same time as the edit-hook test, which writes and
 * deletes `apps/api/src/__lint_edited_probe__/bad.ts`. It has been seen on an
 * unmodified tree in as many as 1 run out of 3.
 *
 * Only ENOENT is swallowed. Any other read error (a permission problem, a
 * directory where a file was expected) is a real fault and still throws.
 */
function readSnapshotFile(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function scan(
  sourceFiles: readonly string[],
  pattern: RegExp,
  locator: Locator,
  rule: string,
  message: string,
): IViolation[] {
  const violations: IViolation[] = [];

  for (const file of sourceFiles) {
    if (isGenerated(file)) {
      continue;
    }
    const source = readSnapshotFile(file);
    if (source === null) {
      continue;
    }
    // Cheap reject first: rescanning the file is only worth it for the few that
    // mention the text at all.
    if (!pattern.test(source)) {
      continue;
    }
    const hit =
      locator.kind === 'comment-directive'
        ? hasDirectiveComment(source, locator.directive, file)
        : pattern.test(codeOnlySource(source, file));
    if (hit) {
      violations.push({ file, rule, message });
    }
  }

  return violations;
}

/** No inline `// eslint-disable` directives in hand-written source. */
export const noInlineLintDisableRule: IMetaRule = {
  id: 'no-inline-lint-disable',
  category: 'source-text',
  ciCritical: true,
  description: 'Source files must not contain inline eslint-disable directives.',
  run({ sourceFiles }: IMetaContext): IViolation[] {
    return scan(
      sourceFiles,
      INLINE_DISABLE,
      { kind: 'comment-directive', directive: INLINE_DISABLE_DIRECTIVE },
      'no-inline-lint-disable',
      INLINE_DISABLE_MESSAGE,
    );
  },
};

/** No `@ts-ignore` / `@ts-expect-error` suppressions in source. */
export const noTsIgnoreRule: IMetaRule = {
  id: 'no-ts-ignore',
  category: 'source-text',
  ciCritical: true,
  description: 'Source files must not contain @ts-ignore / @ts-expect-error suppressions.',
  run({ sourceFiles }: IMetaContext): IViolation[] {
    return scan(
      sourceFiles,
      TS_SUPPRESSION,
      { kind: 'comment-directive', directive: TS_SUPPRESSION_DIRECTIVE },
      'no-ts-ignore',
      TS_SUPPRESSION_MESSAGE,
    );
  },
};

/*
 * Queue registration goes through `registerQueueWithDefaults`, never
 * `BullModule.registerQueue(` directly.
 *
 * `defaultJobOptions` is optional on BullMQ's registration options, so a module
 * that forgets it registers a queue with one attempt and unbounded completed and
 * failed sets, and type-checks. The helper in `apps/api/src/common/queue` takes
 * the whole `IQueueDefaults` object as a required argument, which is what makes
 * the policy impossible to omit; this rule is what makes the helper the only
 * door. The helper itself lives in that folder and calls the real API, so the
 * folder is exempt.
 */
const QUEUE_HELPER_DIR = 'apps/api/src/common/queue/';

export const BULL_REGISTER_QUEUE = /\bBullModule\.registerQueue\s*\(/u;

export const BULL_REGISTER_QUEUE_MESSAGE =
  'Call registerQueueWithDefaults(name, X_DEFAULTS) from common/queue instead of BullModule.registerQueue(. A bare registerQueue can omit defaultJobOptions, which ships one attempt and an unbounded DLQ.';

/** Only `common/queue` may call BullMQ's registration API directly. */
export const queueRegistrationThroughHelperRule: IMetaRule = {
  id: 'queue-registration-through-helper',
  category: 'source-text',
  ciCritical: true,
  description:
    'Queues must be registered with registerQueueWithDefaults from common/queue, not a bare BullModule.registerQueue call.',
  run({ sourceFiles }: IMetaContext): IViolation[] {
    const outsideHelper = sourceFiles.filter(
      (file) => !file.split('\\').join('/').includes(QUEUE_HELPER_DIR),
    );

    return scan(
      outsideHelper,
      BULL_REGISTER_QUEUE,
      { kind: 'code' },
      'queue-registration-through-helper',
      BULL_REGISTER_QUEUE_MESSAGE,
    );
  },
};

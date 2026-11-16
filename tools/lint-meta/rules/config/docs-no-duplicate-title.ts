import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

/*
 * A docs page must not repeat its own title as a literal H1.
 *
 * Starlight renders the frontmatter `title` as the page heading. A page that
 * also opens with `# Title` shows the reader the same words twice, stacked,
 * and 36 of the 37 pages did exactly that. Thirty-six pages agreeing on one
 * mistake is not thirty-six mistakes, it is a convention nobody wrote down,
 * so the fix is a check rather than a sweep: the next page added would have
 * repeated it otherwise.
 *
 * The assertion is any H1 at all, not just one matching the frontmatter title.
 * A page whose H1 is a near-miss of its title (`Shared UI Package (@repo/ui)`
 * against the same string with backticks) renders as two almost-identical
 * headings, which reads as a bug rather than as a deliberate second heading,
 * and Starlight's own table of contents starts at `##` regardless. There is no
 * page-level H1 the body is allowed to own.
 *
 * Fence-aware, because several pages carry shell snippets whose comment lines
 * start with `# `. A `# install deps` inside a ```bash block is not a heading
 * and flagging it would make the rule unusable on the ops runbooks.
 */
const DOCS_CONTENT_DIR = join('apps', 'docs', 'src', 'content', 'docs');

const PAGE_EXTENSIONS = ['.md', '.mdx'];

const FENCE = /^(?:```+|~~~+)/u;
const H1 = /^# /u;

function listPages(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...listPages(full));
      continue;
    }

    if (PAGE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      out.push(full);
    }
  }

  return out;
}

/**
 * Line number (1-based) of the first H1 outside a code fence and outside the
 * frontmatter block, or `undefined` when the page has none.
 */
export function findLiteralH1(source: string): number | undefined {
  const lines = source.split('\n');
  let cursor = 0;

  // Skip the frontmatter. `---` inside it never opens a fence, and a horizontal
  // rule in the body is `---` on its own line too, so the block is only skipped
  // when the very first line opens it.
  if (lines[0]?.trim() === '---') {
    cursor = 1;
    while (cursor < lines.length && lines[cursor]?.trim() !== '---') {
      cursor += 1;
    }
    cursor += 1;
  }

  let openFence: string | undefined;

  for (let index = cursor; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const fence = FENCE.exec(line);

    if (fence !== null) {
      // A fence closes only on a marker of its own family and at least its own
      // length, so a ```` ``` ```` inside a ```` ```` ```` block does not end it.
      if (openFence === undefined) {
        openFence = fence[0];
      } else if (line.startsWith(openFence)) {
        openFence = undefined;
      }
      continue;
    }

    if (openFence !== undefined) {
      continue;
    }

    if (H1.test(line)) {
      return index + 1;
    }
  }

  return undefined;
}

export function checkDocsNoDuplicateTitle(root: string): IViolation[] {
  const contentPath = join(root, DOCS_CONTENT_DIR);

  if (!existsSync(contentPath)) {
    return [];
  }

  const violations: IViolation[] = [];

  for (const page of listPages(contentPath)) {
    const line = findLiteralH1(readFileSync(page, 'utf8'));

    if (line === undefined) {
      continue;
    }

    violations.push({
      file: relative(root, page).split(sep).join('/'),
      rule: 'docs-no-duplicate-title',
      message: `Literal H1 on line ${String(line)}. Starlight already renders the frontmatter \`title\` as the page heading, so this shows the reader the title twice. Delete the \`# \` line; the body starts at \`##\`.`,
    });
  }

  return violations;
}

/** No docs page may open with a literal H1; Starlight renders the title itself. */
export const docsNoDuplicateTitleRule: IMetaRule = {
  id: 'docs-no-duplicate-title',
  category: 'config',
  ciCritical: true,
  description:
    'Docs pages must not contain a literal H1; Starlight renders the frontmatter title as the page heading.',
  run({ root }: IMetaContext): IViolation[] {
    return checkDocsNoDuplicateTitle(root);
  },
};

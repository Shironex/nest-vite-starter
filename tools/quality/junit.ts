/**
 * A reader for the JUnit XML `jest-junit` writes.
 *
 * Deliberately small and dependency-free: the reconciler needs four facts per
 * case (which suite file, which name, what happened, and what was said about
 * it), and the document it reads is one this repo produces, with a shape pinned
 * by `apps/api/jest.security.config.js`. A general XML parser would be a new
 * dependency in the one place that is supposed to be boring.
 *
 * It is strict where being wrong would be silent: an `<error>` is reported as
 * its own status rather than folded into "failed", because an error is a case
 * that never got to assert anything, and the reconciler must not read that as
 * evidence.
 */

export type CaseStatus = 'passed' | 'failed' | 'skipped' | 'errored';

export interface IJUnitCase {
  /** The `<testsuite name>`, which the security config sets to the file name. */
  readonly suite: string;
  /** The `file` attribute (a repo-relative path), or the suite name when absent. */
  readonly file: string;
  /** The `<testcase name>`: the describe chain plus the case title. */
  readonly name: string;
  readonly status: CaseStatus;
  /** Whatever the `<failure>` / `<error>` bodies said, in order. */
  readonly messages: readonly string[];
}

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#10;': '\n',
  '&#13;': '\r',
  '&#9;': '\t',
};

/** Decode the entities `xml` escapes on the way out. `&amp;` last, or `&amp;lt;` decodes twice. */
export function decodeXml(text: string): string {
  let out = text;
  for (const [entity, char] of Object.entries(ENTITIES)) {
    out = out.split(entity).join(char);
  }
  return out.split('&amp;').join('&');
}

function attributes(fragment: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of fragment.matchAll(/([A-Za-z_][\w:.-]*)="([^"]*)"/gu)) {
    const [, key, value] = match;
    if (key !== undefined && value !== undefined) {
      out[key] = decodeXml(value);
    }
  }
  return out;
}

/** The text of every `<tag ...>body</tag>` (CDATA unwrapped), in document order. */
function childText(body: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gu');
  return [...body.matchAll(pattern)].map((match) => {
    const raw = match[1] ?? '';
    const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/u.exec(raw);
    return cdata === null ? decodeXml(raw).trim() : (cdata[1] ?? '').trim();
  });
}

function hasChild(body: string, tag: string): boolean {
  return new RegExp(`<${tag}\\b`, 'u').test(body);
}

function statusOf(body: string): CaseStatus {
  if (hasChild(body, 'error')) {
    return 'errored';
  }
  if (hasChild(body, 'failure')) {
    return 'failed';
  }
  if (hasChild(body, 'skipped')) {
    return 'skipped';
  }
  return 'passed';
}

/** Every `<testcase>` in the document, flattened, in document order. */
export function parseJUnit(xml: string): IJUnitCase[] {
  const cases: IJUnitCase[] = [];

  for (const suite of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/gu)) {
    const suiteAttrs = attributes(suite[1] ?? '');
    const suiteName = suiteAttrs.name ?? '';
    const suiteBody = suite[2] ?? '';

    for (const testcase of suiteBody.matchAll(
      /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/gu,
    )) {
      const caseAttrs = attributes(testcase[1] ?? '');
      const body = testcase[3] ?? '';

      cases.push({
        suite: suiteName,
        file: caseAttrs.file ?? suiteName,
        name: caseAttrs.name ?? '',
        status: statusOf(body),
        messages: [...childText(body, 'failure'), ...childText(body, 'error')],
      });
    }
  }

  return cases;
}

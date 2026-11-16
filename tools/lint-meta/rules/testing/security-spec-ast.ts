import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';

/*
 * Shared reader for the two rules that police `apps/api/security-spec/`
 * (security-spec-no-silent-bail, security-spec-requires-control).
 *
 * It parses, rather than scanning lines, because both rules ask structural
 * questions that text answers wrongly: a `control:` case named in a comment or
 * living in a SIBLING suite must not satisfy the control rule, and a `return`
 * inside a nested arrow function is not a bail out of the case. The TypeScript
 * compiler is used in syntax-only mode (no program, no type checker), the same
 * way `source-text/trpc-procedures.ts` reads the router decorators.
 *
 * The folder is not under `{src,test,tests}`, so it is outside the source files
 * `buildContext` collects; both rules walk it from `ctx.root` instead.
 */

/** Where the lane lives, and what a file in it is called. */
export const SECURITY_SPEC_DIR = join('apps', 'api', 'security-spec');
export const SECURITY_SPEC_SUFFIX = '.security-spec.ts';

const SKIP_DIRS = new Set(['node_modules', '.junit', 'dist', 'coverage']);

export interface ISpecSource {
  /** Repo-relative POSIX path, for messages. */
  readonly file: string;
  readonly source: string;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith(SECURITY_SPEC_SUFFIX)) {
      out.push(full);
    }
  }
}

/** Every security spec in the repository at `root`, sorted, with its text. */
export function collectSecuritySpecs(root: string): ISpecSource[] {
  const files: string[] = [];
  walk(join(root, SECURITY_SPEC_DIR), files);

  return files.sort().map((file) => ({
    file: relative(root, file).split(sep).join('/'),
    source: readFileSync(file, 'utf8'),
  }));
}

export interface ITestNode {
  /** `describe` blocks nest; `test` nodes are the cases themselves. */
  readonly kind: 'suite' | 'case';
  /** The callee as written, e.g. `describe`, `it.skip`, `xit`, `it.each`. */
  readonly callee: string;
  /** The first argument when it is a plain string; null when it is computed. */
  readonly title: string | null;
  /** 1-based line of the call. */
  readonly line: number;
  /** The callback node, when the call was given one. */
  readonly body: ts.Node | null;
  readonly children: ITestNode[];
}

const SUITE_ROOTS = new Set(['describe', 'xdescribe', 'fdescribe']);
const CASE_ROOTS = new Set(['it', 'test', 'xit', 'fit', 'xtest', 'ftest']);

/**
 * The callee as source text, flattened to identifiers and property names:
 * `it.skip` -> "it.skip", `it.each(rows)` -> "it.each". Anything else is null,
 * which is how a call on a computed member or on a non-identifier is ignored.
 */
function calleeChain(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const left = calleeChain(expression.expression);
    return left === null ? null : `${left}.${expression.name.text}`;
  }
  // `it.each(rows)(...)`: the interesting part is the inner callee.
  if (ts.isCallExpression(expression)) {
    return calleeChain(expression.expression);
  }
  if (ts.isTaggedTemplateExpression(expression)) {
    return calleeChain(expression.tag);
  }
  return null;
}

function literalTitle(node: ts.Node | undefined): string | null {
  if (node === undefined) {
    return null;
  }
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return null;
  }
  return null;
}

function callbackOf(call: ts.CallExpression): ts.Node | null {
  for (let index = call.arguments.length - 1; index >= 0; index -= 1) {
    const argument = call.arguments[index];
    if (
      argument !== undefined &&
      (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
    ) {
      return argument;
    }
  }
  return null;
}

/**
 * The describe/it tree of one file.
 *
 * A node's `children` are the suites and cases lexically inside its callback, so
 * "this suite owns a control" is a question about the tree rather than about
 * the order of lines in the file.
 */
export function readSuites(file: string, source: string): ITestNode[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const roots: ITestNode[] = [];

  const visit = (node: ts.Node, parent: ITestNode | null): void => {
    // `it.each(rows)(name, fn)` is a call whose callee is itself a call. The
    // outer one carries the title, so the inner one is passed over rather than
    // counted as a second case.
    const isInnerCallee =
      ts.isCallExpression(node) &&
      node.parent !== undefined &&
      ts.isCallExpression(node.parent) &&
      node.parent.expression === node;

    if (ts.isCallExpression(node) && !isInnerCallee) {
      const callee = calleeChain(node.expression);
      const root = callee?.split('.')[0] ?? '';
      const kind = SUITE_ROOTS.has(root) ? 'suite' : CASE_ROOTS.has(root) ? 'case' : null;

      if (callee !== null && kind !== null) {
        const entry: ITestNode = {
          kind,
          callee,
          title: literalTitle(node.arguments[0]),
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          body: callbackOf(node),
          children: [],
        };
        if (parent === null) {
          roots.push(entry);
        } else {
          parent.children.push(entry);
        }
        node.forEachChild((child) => {
          visit(child, entry);
        });
        return;
      }
    }

    node.forEachChild((child) => {
      visit(child, parent);
    });
  };

  visit(sourceFile, null);
  return roots;
}

/** Every node in the tree, parents before children. */
export function flatten(nodes: readonly ITestNode[]): ITestNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** Whether a case title marks it as the suite's positive control. */
export function isControlTitle(title: string | null): boolean {
  return title !== null && title.trimStart().toLowerCase().startsWith('control:');
}

/**
 * Walk `node`'s own body, NOT descending into nested function bodies.
 *
 * What a case does directly is a different question from what a helper it calls
 * does: a `return` inside a `.map(...)` callback is ordinary code, and a
 * `return` in the case itself ends it with nothing asserted.
 */
export function visitOwnBody(node: ts.Node, visitor: (child: ts.Node) => void): void {
  const step = (child: ts.Node): void => {
    visitor(child);
    if (
      ts.isArrowFunction(child) ||
      ts.isFunctionExpression(child) ||
      ts.isFunctionDeclaration(child)
    ) {
      return;
    }
    child.forEachChild(step);
  };

  node.forEachChild(step);
}

/**
 * Whether the case asserts: `expect(...)` anywhere inside `node` (nested
 * callbacks included), or a call to a helper whose name STARTS with `expect`.
 *
 * The helper clause is the convention that keeps this rule honest without a
 * type checker: a spec may factor its assertions into `expectNoSentinel(...)`
 * or `expectRefused(...)`, and naming them that way is what makes the assertion
 * visible here. A helper called `check(...)` is indistinguishable from any
 * other call, so the rule counts it as no assertion at all.
 */
export function callsExpect(node: ts.Node): boolean {
  let found = false;

  const step = (child: ts.Node): void => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(child)) {
      const root = calleeChain(child.expression)?.split('.')[0] ?? '';
      if (root.startsWith('expect')) {
        found = true;
        return;
      }
    }
    child.forEachChild(step);
  };

  node.forEachChild(step);
  return found;
}

export { ts };

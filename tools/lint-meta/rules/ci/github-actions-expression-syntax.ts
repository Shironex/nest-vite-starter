import { readFileSync } from 'node:fs';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';
import { stripYamlComment, unquote } from './repo-files';

const RULE_ID = 'github-actions-expression-syntax';

const NUMBER = /^-?\d[\w.+-]*/u;
const IDENTIFIER = /^[A-Za-z_][\w-]*(?:\.(?:[A-Za-z_][\w-]*|\*))*/u;
const MEMBER = /^\.(?:[A-Za-z_][\w-]*|\*)/u;
const OPERATOR = /^(?:==|!=|<=|>=|&&|\|\||<|>)/u;

interface IExpressionScan {
  /** Offset just past the closing `}}`, or the end of the text when it never closes. */
  readonly end: number;
  readonly problem: string | null;
}

/*
 * A workflow with a malformed `${{ }}` expression is rejected by GitHub only once the run starts,
 * and one that parses but means something else (an `if:` that mixes an expression with text is a
 * non-empty string, so always true) never fails at all. This scans expressions the way the runner
 * tokenizes them, well enough to catch the mistakes a hand edit makes: an unclosed `${{`, an
 * unterminated string, unbalanced brackets, a dangling operator, two operands in a row, a stray
 * character (`=`, `&`, `;`), and a leading `!` that YAML reads as a tag.
 *
 * It is not a full evaluator: function names and context paths are not checked against a schema.
 */
export function scanExpression(text: string, start: number): IExpressionScan {
  const stack: string[] = [];
  let expectOperand = true;
  let sawToken = false;
  let afterOpenCall = false;
  let position = start;

  const fail = (problem: string): IExpressionScan => {
    const close = text.indexOf('}}', position);
    return { end: close === -1 ? text.length : close + 2, problem };
  };

  while (position < text.length) {
    const rest = text.slice(position);
    const char = rest[0] ?? '';

    if (/\s/u.test(char)) {
      position += 1;
      continue;
    }

    if (rest.startsWith('}}')) {
      if (!sawToken) {
        return { end: position + 2, problem: 'the expression is empty' };
      }
      if (stack.length > 0) {
        return { end: position + 2, problem: `unclosed "${stack[stack.length - 1]}"` };
      }
      if (expectOperand) {
        return { end: position + 2, problem: 'the expression ends after an operator' };
      }
      return { end: position + 2, problem: null };
    }

    const wasAfterOpenCall = afterOpenCall;
    afterOpenCall = false;
    sawToken = true;

    if (char === "'") {
      let cursor = position + 1;
      for (;;) {
        if (cursor >= text.length) {
          return { end: text.length, problem: 'unterminated string' };
        }
        if (text[cursor] === "'") {
          if (text[cursor + 1] === "'") {
            cursor += 2;
            continue;
          }
          break;
        }
        cursor += 1;
      }
      if (!expectOperand) {
        return fail('a string appears where an operator is expected');
      }
      position = cursor + 1;
      expectOperand = false;
      continue;
    }

    const number = NUMBER.exec(rest);
    if (number !== null && expectOperand) {
      position += number[0].length;
      expectOperand = false;
      continue;
    }

    const identifier = IDENTIFIER.exec(rest);
    if (identifier !== null) {
      if (!expectOperand) {
        return fail(`"${identifier[0]}" appears where an operator is expected`);
      }
      position += identifier[0].length;
      if (text[position] === '(') {
        stack.push('(');
        position += 1;
        afterOpenCall = true;
      } else {
        expectOperand = false;
      }
      continue;
    }

    const member = MEMBER.exec(rest);
    if (member !== null && !expectOperand) {
      position += member[0].length;
      continue;
    }

    const operator = OPERATOR.exec(rest);
    if (operator !== null) {
      if (expectOperand) {
        return fail(`operator "${operator[0]}" has no left operand`);
      }
      position += operator[0].length;
      expectOperand = true;
      continue;
    }

    if (char === '!') {
      if (!expectOperand) {
        return fail('"!" appears where an operator is expected');
      }
      position += 1;
      continue;
    }

    if (char === '(') {
      if (!expectOperand) {
        return fail('"(" appears where an operator is expected');
      }
      stack.push('(');
      position += 1;
      continue;
    }

    if (char === '[') {
      if (expectOperand) {
        return fail('"[" has nothing to index');
      }
      stack.push('[');
      position += 1;
      expectOperand = true;
      continue;
    }

    if (char === ')' || char === ']') {
      const opener = char === ')' ? '(' : '[';
      if (stack[stack.length - 1] !== opener) {
        return fail(`unbalanced "${char}"`);
      }
      if (expectOperand && !(char === ')' && wasAfterOpenCall)) {
        return fail(`"${char}" closes an incomplete expression`);
      }
      stack.pop();
      position += 1;
      expectOperand = false;
      continue;
    }

    if (char === ',') {
      if (expectOperand || stack[stack.length - 1] !== '(') {
        return fail('unexpected ","');
      }
      position += 1;
      expectOperand = true;
      continue;
    }

    return fail(`unexpected character "${char}"`);
  }

  return { end: text.length, problem: 'the expression is never closed with `}}`' };
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

const IF_LINE = /^\s*(?:-\s+)?if:\s*(.*)$/u;

export function checkWorkflowExpressions(file: string): IViolation[] {
  const violations: IViolation[] = [];
  const rawLines = readFileSync(file, 'utf8').split('\n');
  // Full-line comments may quote `${{` freely; blank them but keep the line numbers.
  const text = rawLines.map((line) => (line.trimStart().startsWith('#') ? '' : line)).join('\n');

  let cursor = text.indexOf('${{');
  while (cursor !== -1) {
    const scan = scanExpression(text, cursor + 3);
    if (scan.problem !== null) {
      violations.push({
        file,
        rule: RULE_ID,
        message: `line ${lineOf(text, cursor)}: invalid \`\${{ }}\` expression: ${scan.problem}.`,
      });
    }
    cursor = text.indexOf('${{', Math.max(scan.end, cursor + 3));
  }

  rawLines.forEach((line, index) => {
    const match = IF_LINE.exec(line);
    if (match === null || line.trimStart().startsWith('#')) {
      return;
    }

    const rawValue = stripYamlComment(match[1] ?? '').trim();
    if (rawValue === '' || rawValue.startsWith('|') || rawValue.startsWith('>')) {
      return;
    }

    const where = `line ${index + 1}`;

    if (/^[!*&]/u.test(rawValue)) {
      violations.push({
        file,
        rule: RULE_ID,
        message: `${where}: \`if: ${rawValue}\` starts with "${rawValue[0]}", which YAML reads as a tag, alias or anchor. Wrap the condition in \`\${{ }}\`.`,
      });
      return;
    }

    const value = unquote(rawValue);
    const open = value.indexOf('${{');
    if (open === -1) {
      return;
    }

    const scan = scanExpression(value, open + 3);
    if (open !== 0 || value.slice(scan.end).trim() !== '') {
      violations.push({
        file,
        rule: RULE_ID,
        message: `${where}: \`if:\` mixes a \`\${{ }}\` expression with other text, so GitHub treats it as a non-empty string that is always true. Put the whole condition inside one \`\${{ }}\`.`,
      });
    }
  });

  return violations;
}

/** Every `${{ }}` expression in a workflow must parse, and `if:` must be one whole expression. */
export const githubActionsExpressionSyntaxRule: IMetaRule = {
  id: RULE_ID,
  category: 'ci',
  ciCritical: true,
  description:
    'GitHub Actions ${{ }} expressions must parse (balanced, no stray operators), and an `if:` must be a single whole expression.',
  run({ workflowFiles }: IMetaContext): IViolation[] {
    return workflowFiles.flatMap(checkWorkflowExpressions);
  },
};

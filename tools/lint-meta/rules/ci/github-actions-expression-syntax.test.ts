import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { githubActionsExpressionSyntaxRule } from './github-actions-expression-syntax';

function violationsFor(text: string) {
  const fixture = createFixture({ '.github/workflows/ci.yml': text });
  return runSync(githubActionsExpressionSyntaxRule, fixture.context());
}

function step(line: string): string {
  return `jobs:\n  a:\n    steps:\n      - run: echo\n        ${line}\n`;
}

describe('github-actions-expression-syntax', () => {
  it('passes the expression shapes the repo uses', () => {
    const text = [
      'env:',
      '  A: ${{ secrets.TURBO_TOKEN }}',
      "  B: ${{ github.event_name == 'pull_request' && '--affected' || '' }}",
      "  C: ${{ hashFiles('apps/web/package.json') }}",
      "  D: ${{ steps.playwright-cache.outputs.cache-hit != 'true' }}",
      "  E: ${{ github.actor != 'dependabot[bot]' }}",
      "  F: ${{ !cancelled() && (failure() || contains(github.ref, 'x')) }}",
      '  G: ${{ fromJSON(needs.a.outputs.list)[0].name }}',
      '  H: ${{ github.run_attempt > 1 }}',
      '',
    ].join('\n');

    assert.deepEqual(violationsFor(text), []);
  });

  it('reports an expression that is never closed', () => {
    const atEnd = violationsFor('env:\n  A: ${{ github.ref\n');
    const beforeMoreYaml = violationsFor('env:\n  A: ${{ github.ref\n  B: x\n');

    assert.equal(atEnd.length, 1);
    assert.equal(atEnd[0]?.rule, 'github-actions-expression-syntax');
    assert.match(atEnd[0]?.message ?? '', /line 2: invalid .* never closed/u);
    assert.equal(beforeMoreYaml.length, 1);
  });

  it('reports an unterminated string, an empty expression and unbalanced brackets', () => {
    assert.match(
      violationsFor("env:\n  A: ${{ 'abc }}\n")[0]?.message ?? '',
      /unterminated string/u,
    );
    assert.match(violationsFor('env:\n  A: ${{ }}\n')[0]?.message ?? '', /is empty/u);
    assert.match(
      violationsFor("env:\n  A: ${{ contains(github.ref, 'x' }}\n")[0]?.message ?? '',
      /unclosed "\("/u,
    );
    assert.match(
      violationsFor('env:\n  A: ${{ (a && b)) }}\n')[0]?.message ?? '',
      /unbalanced "\)"/u,
    );
  });

  it('reports a dangling or doubled operator and two operands in a row', () => {
    assert.match(
      violationsFor('env:\n  A: ${{ a && }}\n')[0]?.message ?? '',
      /ends after an operator/u,
    );
    assert.match(violationsFor('env:\n  A: ${{ && a }}\n')[0]?.message ?? '', /no left operand/u);
    assert.match(
      violationsFor('env:\n  A: ${{ a b }}\n')[0]?.message ?? '',
      /"b" appears where an operator/u,
    );
  });

  it('reports a stray character such as = or a single &', () => {
    assert.match(
      violationsFor('env:\n  A: ${{ a = b }}\n')[0]?.message ?? '',
      /unexpected character "="/u,
    );
    assert.match(
      violationsFor('env:\n  A: ${{ a & b }}\n')[0]?.message ?? '',
      /unexpected character "&"/u,
    );
  });

  it('does not end an expression at a }} inside a string', () => {
    assert.deepEqual(violationsFor("env:\n  A: ${{ format('{{0}}', github.ref) }}\n"), []);
  });

  it('ignores ${{ quoted in a full-line comment', () => {
    assert.deepEqual(violationsFor('# use ${{ oops\nenv:\n  A: 1\n'), []);
  });

  it('reports an `if:` that mixes an expression with text, which is always true', () => {
    const violations = violationsFor(step("if: ${{ github.ref == 'x' }} && github.actor == 'y'"));

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /always true/u);
  });

  it('reports an `if:` that starts with ! (a YAML tag)', () => {
    const violations = violationsFor(step('if: !cancelled()'));

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /YAML reads as a tag/u);
  });

  it('passes an `if:` that is one whole expression or a bare condition', () => {
    assert.deepEqual(violationsFor(step("if: ${{ github.ref == 'x' }}")), []);
    assert.deepEqual(violationsFor(step("if: github.event_name == 'push'")), []);
    assert.deepEqual(violationsFor(step("if: '${{ !cancelled() }}' # only when live")), []);
  });
});

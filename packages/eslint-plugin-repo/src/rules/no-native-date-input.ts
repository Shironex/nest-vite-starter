import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { isAllowlisted } from '../utils/allowlist';
import { createRule } from '../utils/createRule';

export const RULE_NAME = 'no-native-date-input';

export interface NoNativeDateInputOptions {
  /** Globs the rule applies to, matched against the file's path. */
  readonly includeFiles?: readonly string[];
  /** Element names that render a raw `<input>`. */
  readonly elementNames?: readonly string[];
  /** `type` values whose native rendering is locale-dependent. */
  readonly types?: readonly string[];
  /** What the message tells people to use instead. */
  readonly replacement?: string;
}

type RuleOptions = [NoNativeDateInputOptions];
type MessageIds = 'nativeDateInput';

/*
 * WHY A LINT RULE AND NOT A CODE REVIEW NOTE.
 *
 * `<input type="date">` looks correct in every way a reviewer can check: it is
 * the semantic element, it is keyboard accessible, it validates, and it renders
 * perfectly on the machine of anyone whose browser is installed in the same
 * language as the product. The defect is invisible from the code and invisible
 * from a developer's own screen.
 *
 * The measurement behind this rule: Chromium takes a date input's display
 * format from the BROWSER'S UI LANGUAGE, and ignores both the element's `lang`
 * attribute and the browsing context's locale. A day-first product served
 * with `<html lang="en-GB">` still renders `03/04/2026` month-first on a Chrome
 * installed in US English, and 3 April and 4 March are not distinguishable. A date in a business
 * product is often a deadline (a contract end, a renewal, a due date), so
 * that ambiguity is a correctness defect, not a cosmetic one. Firefox honors `lang`; Chrome does not.
 *
 * `datetime-local`, `month` and `week` are covered for the same reason: their
 * native rendering is the browser's, in the browser's language.
 *
 * The rule is deliberately SYNTACTIC. It matches `<input>` and `<Input>` with a
 * literal `type`, which is how every one of the twelve call sites this replaced
 * was written. A wrapper that forwards `type={someVariable}` to an `<Input>` is
 * out of reach here and always will be; the answer to that shape is to branch
 * on the date case before the `<Input>` is reached, which is what the app's
 * field-router components now do.
 */

const DEFAULT_INCLUDE_FILES: readonly string[] = [
  '**/apps/web/src/**/*.tsx',
  '**/apps/desktop/src/**/*.tsx',
  '**/packages/ui/src/**/*.tsx',
];

const DEFAULT_ELEMENT_NAMES: readonly string[] = ['input', 'Input'];

const DEFAULT_TYPES: readonly string[] = ['date', 'datetime-local', 'month', 'week'];

const DEFAULT_REPLACEMENT = '@/features/shared/components/DateField';

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    includeFiles: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    elementNames: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    types: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    replacement: { type: 'string' },
  },
};

/** The element's tag name, or null for a member expression like `Form.Input`. */
function elementName(node: TSESTree.JSXOpeningElement): string | null {
  return node.name.type === AST_NODE_TYPES.JSXIdentifier ? node.name.name : null;
}

/** The literal value of a `type` attribute, whether braced or not. */
function literalTypeValue(attribute: TSESTree.JSXAttribute): string | null {
  const value = attribute.value;
  if (value === null) return null;
  if (value.type === AST_NODE_TYPES.Literal) {
    return typeof value.value === 'string' ? value.value : null;
  }
  if (
    value.type === AST_NODE_TYPES.JSXExpressionContainer &&
    value.expression.type === AST_NODE_TYPES.Literal &&
    typeof value.expression.value === 'string'
  ) {
    return value.expression.value;
  }
  return null;
}

export const noNativeDateInputRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow native date inputs. Chromium renders them in the browser UI language and ignores `lang`, so the field can show a different date order than the rest of the product, and 3 April reads as 4 March.',
    },
    schema: [optionSchema],
    messages: {
      nativeDateInput:
        'Native `type="{{type}}"` input. Chromium formats it from the BROWSER\'s UI language and ignores `lang`, so its date order can differ from the product locale and 3 April becomes indistinguishable from 4 March. Use `{{replacement}}` instead; it holds the same `yyyy-MM-dd` value.',
    },
  },
  defaultOptions: [
    {
      includeFiles: [...DEFAULT_INCLUDE_FILES],
      elementNames: [...DEFAULT_ELEMENT_NAMES],
      types: [...DEFAULT_TYPES],
      replacement: DEFAULT_REPLACEMENT,
    },
  ],
  create(context, [options]) {
    const includeFiles = options.includeFiles ?? DEFAULT_INCLUDE_FILES;
    const elementNames = new Set(options.elementNames ?? DEFAULT_ELEMENT_NAMES);
    const types = new Set(options.types ?? DEFAULT_TYPES);
    const replacement = options.replacement ?? DEFAULT_REPLACEMENT;

    if (!isAllowlisted(context.filename, includeFiles)) return {};

    return {
      JSXOpeningElement(node): void {
        const name = elementName(node);
        if (name === null || !elementNames.has(name)) return;

        for (const attribute of node.attributes) {
          if (attribute.type !== AST_NODE_TYPES.JSXAttribute) continue;
          if (attribute.name.type !== AST_NODE_TYPES.JSXIdentifier) continue;
          if (attribute.name.name !== 'type') continue;

          const value = literalTypeValue(attribute);
          if (value === null || !types.has(value)) continue;

          context.report({
            node: attribute,
            messageId: 'nativeDateInput',
            data: { type: value, replacement },
          });
        }
      },
    };
  },
});

import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { isAllowlisted } from '../utils/allowlist';
import { createRule } from '../utils/createRule';

export const RULE_NAME = 'no-hardcoded-ui-strings';

export interface NoHardcodedUiStringsOptions {
  /**
   * Globs the rule applies to, matched against the file's monorepo-root-relative
   * path. Prefer `**\/`-anchored globs so they hold whichever directory ESLint
   * is invoked from. An empty list means the rule applies nowhere.
   */
  readonly includeFiles?: readonly string[];
  /** JSX attributes whose string values are user-visible copy. */
  readonly translatableAttributes?: readonly string[];
  /**
   * Globs carved back out of `includeFiles`, matched the same way. Replaces the
   * default list rather than extending it.
   */
  readonly excludeFiles?: readonly string[];
  /** Minimum length before a literal counts as copy rather than a token. */
  readonly minLength?: number;
}

type RuleOptions = [NoHardcodedUiStringsOptions];
type MessageIds = 'hardcodedText' | 'hardcodedAttribute';

/*
 * Every user-visible string has to come from the i18n catalogs (the English
 * `locales/en.json` files) rather than from JSX, so a second language is a new
 * catalog and not a hunt through components. This rule is the gate that keeps a stray literal from
 * reaching a screen with no catalog entry behind it.
 *
 * Scoped by EXCLUSION, not by inclusion: `includeFiles` defaults to every
 * feature folder and every route file, and `excludeFiles` names the few that
 * are not translated yet.
 * The previous default listed the translated folders one by one, which meant a
 * NEW feature folder was exempt until somebody remembered to add it, and lint
 * stayed green while it checked less and less of the app. Now a new folder is
 * policed the day it is created, and leaving it out takes a named entry with a
 * reason.
 *
 * Route files are in scope because they render copy too: the page headings of
 * the sign-in screens lived there, hardcoded, for as long as the rule looked
 * only at features/, and they were the one copy a catalog change could not
 * reach.
 *
 * What it reports:
 *   - JSXText that contains letters, e.g. `<p>Team members</p>`
 *   - string literals in copy-bearing JSX attributes (label, placeholder,
 *     title, alt, aria-label, ...)
 *
 * What it deliberately ignores, because flagging these produces noise that
 * trains people to disable the rule:
 *   - anything under minLength (default 2), which is punctuation and separators
 *   - strings with no letters at all: "42", "-", "/", ":"
 *   - className/id/key/testId/href/src/type/role and other machine-facing
 *     attributes (they are simply not in translatableAttributes)
 *   - `t('...')` calls and template literals, which are already dynamic
 */
// `**/` anchored rather than repo-root anchored so the same glob matches
// whether ESLint runs from the repo root, from apps/web via turbo, or from a
// rule test harness.
const DEFAULT_INCLUDE_FILES: readonly string[] = ['**/features/**/*.tsx', '**/routes/**/*.tsx'];

// Feature folders whose copy is still hardcoded, each with the size of its
// backlog when the rule was widened. An entry comes out when its strings move
// to a locales/ catalog; nothing else should ever be added here without a
// reason of the same kind.
const DEFAULT_EXCLUDE_FILES: readonly string[] = [
  // The public marketing page: hardcoded English with no catalog yet, about
  // 30 strings across 9 sections.
  '**/features/landing/**',
];

const DEFAULT_TRANSLATABLE_ATTRIBUTES: readonly string[] = [
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'description',
  'emptyMessage',
  'errorMessage',
  'heading',
  'helperText',
  'label',
  'placeholder',
  'subtitle',
  'title',
  'tooltip',
];

const DEFAULT_MIN_LENGTH = 2;

/** Test files carry fixture copy and assertions; sidecar stories are demos. */
const ALWAYS_SKIPPED: readonly string[] = ['**/*.test.tsx', '**/*.spec.tsx', '**/*.stories.tsx'];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    includeFiles: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
    excludeFiles: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
    translatableAttributes: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
    minLength: { type: 'integer', minimum: 1 },
  },
};

/**
 * Whether a literal reads as human copy. Requires at least one letter, so
 * numbers, punctuation, separators and format tokens never trip the rule.
 */
function looksLikeCopy(raw: string, minLength: number): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < minLength) return false;
  return /\p{L}/u.test(trimmed);
}

/** The attribute name of a JSX attribute node, namespaced names included. */
function attributeName(node: TSESTree.JSXAttribute): string | null {
  if (node.name.type === AST_NODE_TYPES.JSXIdentifier) return node.name.name;
  return null;
}

export const noHardcodedUiStringsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hardcoded user-visible strings in feature folders and route files. Copy must come from the i18n catalogs, and a new feature folder is policed by default rather than exempt until someone remembers it.',
    },
    schema: [optionSchema],
    messages: {
      hardcodedText:
        'Hardcoded UI text "{{text}}". These screens render from the i18n catalogs; move the copy to the feature\'s locales/ files and render it with t().',
      hardcodedAttribute:
        'Hardcoded text in the `{{attribute}}` attribute ("{{text}}"). Move the copy to the feature\'s locales/ files and pass t() instead.',
    },
  },
  defaultOptions: [
    {
      includeFiles: [...DEFAULT_INCLUDE_FILES],
      excludeFiles: [...DEFAULT_EXCLUDE_FILES],
      translatableAttributes: [...DEFAULT_TRANSLATABLE_ATTRIBUTES],
      minLength: DEFAULT_MIN_LENGTH,
    },
  ],
  create(context, [options]) {
    const includeFiles = options.includeFiles ?? DEFAULT_INCLUDE_FILES;
    const excludeFiles = options.excludeFiles ?? DEFAULT_EXCLUDE_FILES;
    const translatableAttributes = new Set(
      options.translatableAttributes ?? DEFAULT_TRANSLATABLE_ATTRIBUTES,
    );
    const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;

    if (!isAllowlisted(context.filename, includeFiles)) return {};
    if (isAllowlisted(context.filename, excludeFiles)) return {};
    if (isAllowlisted(context.filename, ALWAYS_SKIPPED)) return {};

    /** Truncate for the message so a long paragraph does not fill the terminal. */
    const preview = (value: string): string => {
      const trimmed = value.trim().replace(/\s+/g, ' ');
      return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed;
    };

    return {
      JSXText(node): void {
        if (!looksLikeCopy(node.value, minLength)) return;
        context.report({
          node,
          messageId: 'hardcodedText',
          data: { text: preview(node.value) },
        });
      },

      JSXAttribute(node): void {
        const name = attributeName(node);
        if (name === null || !translatableAttributes.has(name)) return;

        const value = node.value;
        if (value === null) return;

        // `label="Team members"`
        if (value.type === AST_NODE_TYPES.Literal) {
          if (typeof value.value !== 'string' || !looksLikeCopy(value.value, minLength)) return;
          context.report({
            node: value,
            messageId: 'hardcodedAttribute',
            data: { attribute: name, text: preview(value.value) },
          });
          return;
        }

        // `label={"Team members"}`: same literal, one layer of braces.
        if (
          value.type === AST_NODE_TYPES.JSXExpressionContainer &&
          value.expression.type === AST_NODE_TYPES.Literal &&
          typeof value.expression.value === 'string' &&
          looksLikeCopy(value.expression.value, minLength)
        ) {
          context.report({
            node: value.expression,
            messageId: 'hardcodedAttribute',
            data: { attribute: name, text: preview(value.expression.value) },
          });
        }
      },
    };
  },
});

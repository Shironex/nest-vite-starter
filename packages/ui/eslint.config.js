import { config as reactConfig } from '@repo/eslint-config/react';
import { config as reactArchitectureConfig } from '@repo/eslint-config/react-architecture';

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ['storybook-static/**', 'dist/**', 'node_modules/**'] },
  ...reactConfig,
  // Activates only `interface-prefix-i` here: @repo/ui has no `src/features/`
  // dir, so the structural component-folder rules stay inert.
  ...reactArchitectureConfig,
  {
    rules: {
      // Allow cmdk and other library-specific data attributes (cmdk-input-wrapper, etc.)
      'react/no-unknown-property': ['error', { ignore: ['cmdk-input-wrapper'] }],
    },
  },
  {
    /*
     * The calendar wrapper in date-field is a key-delegation container, not a
     * control. What is focusable is the buttons and the `role="gridcell"` days
     * inside it; the wrapper only catches the arrow keys that bubble up from
     * whichever one holds focus, which is how a roving-focus grid is built.
     * Giving it an interactive role or a tabIndex of its own would add a second,
     * meaningless stop in the tab order ahead of the grid it serves.
     *
     * Scoped to the one file so the rule still catches a div pretending to be a
     * button anywhere else in the kit.
     */
    files: ['src/components/date-field.tsx'],
    rules: {
      'jsx-a11y/no-static-element-interactions': 'off',
    },
  },
  {
    files: ['**/*.stories.{ts,tsx}', '**/.storybook/**/*.{ts,tsx}'],
    rules: {
      // Storybook story render functions and decorators legitimately call hooks inline.
      'react-hooks/rules-of-hooks': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
];

import { config as baseConfig } from '@repo/eslint-config/base';
import globals from 'globals';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    files: ['src/main/**/*.{ts,mts,mjs,js}', 'scripts/**/*.{mjs,js}', 'electron-builder.cjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];

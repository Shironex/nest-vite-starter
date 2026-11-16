import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    restoreMocks: true,
    /*
     * JUnit, for the committed test inventory (tools/verify/inventories/).
     * Every run leaves a case list behind, so `pnpm verify:inventory` can see a
     * test that was deleted, skipped or duplicated in a suite that still exits
     * 0. The path is relative to this package and `.agent-state/` is gitignored.
     */
    reporters: [
      'default',
      ['junit', { outputFile: '../../.agent-state/inventory/eslint-plugin-repo.junit.xml' }],
    ],
  },
});

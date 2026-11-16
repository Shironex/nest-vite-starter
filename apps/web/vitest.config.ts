import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    /*
     * JUnit, for the committed test inventory (tools/verify/inventories/).
     * Every run leaves a case list behind, so `pnpm verify:inventory` can see a
     * test that was deleted, skipped or duplicated in a suite that still exits
     * 0. The path is relative to this package and `.agent-state/` is gitignored.
     */
    reporters: ['default', ['junit', { outputFile: '../../.agent-state/inventory/web.junit.xml' }]],
    coverage: {
      provider: 'v8',
      // json-summary writes coverage/coverage-summary.json for the ratchet
      // (scripts/check-coverage.mjs). Keep text + lcov for humans.
      reporter: ['text', 'lcov', 'json-summary'],
      exclude: ['src/test/**', 'src/routeTree.gen.ts', '**/*.stories.tsx'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@api': resolve(__dirname, '../api/src'),
    },
  },
});

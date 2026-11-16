import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

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
    reporters: ['default', ['junit', { outputFile: '../../.agent-state/inventory/ui.junit.xml' }]],
  },
});

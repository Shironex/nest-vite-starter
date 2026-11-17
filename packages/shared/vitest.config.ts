import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure utility code; no DOM environment needed.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

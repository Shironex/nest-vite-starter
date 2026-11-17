import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // react-email's render() runs server-side; no DOM environment needed.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});

import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  // Wiping dist on every watch rebuild leaves a window where index.js exists but
  // the (large, slow to roll up) index.d.ts does not, which makes consumers'
  // tsc watchers flap on TS7016 plus an implicit-any cascade. Keep the previous
  // declarations on disk until the new ones replace them.
  clean: !options.watch,
  sourcemap: true,
  external: ['@prisma/client', '@prisma/adapter-pg', 'pg'],
  noExternal: [],
}));

import { fileURLToPath } from 'node:url';
import { config as loadEnvFile } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// `env('DATABASE_URL')` throws while this config is being loaded, so the value
// has to be in process.env before defineConfig() runs. Bare `dotenv/config`
// only reads `<cwd>/.env`, which is packages/database when turbo runs
// db:generate, a file that does not exist on a fresh clone, so `pnpm dev`
// died on its own `^build` dependency before the API ever started.
//
// Nearest first: dotenv never overwrites an already-set key, so the real
// process environment (CI step env, an exported shell var, turbo's globalEnv
// passthrough) still wins over both files, and a package-local .env still wins
// over the workspace root. The root path is derived from this file rather than
// from cwd so it holds no matter where the prisma CLI is invoked from.
loadEnvFile();
loadEnvFile({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

export default defineConfig({
  // A FOLDER, not a file: Prisma loads every .prisma inside it and resolves
  // relations across them with no imports. Multi-file schema is GA since 6.7.0.
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});

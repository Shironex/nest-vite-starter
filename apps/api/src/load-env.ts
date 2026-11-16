/**
 * Side-effect entry point for environment loading. Kept as its own module so
 * `main.ts` can put it above every other import: ES import bindings are
 * hoisted, so an inline `loadEnvFiles()` call in `main.ts` would run AFTER
 * `./otel` and after the transitive `@nestjs/*` graph had already read
 * `process.env`.
 *
 * Deliberately imports nothing but `node:fs` / `node:path` (via
 * `./config/load-env-files`), so it cannot capture references to the modules
 * `./otel` monkey-patches and therefore cannot break tracing by sitting above
 * it. See ./config/load-env-files.ts for the precedence rules.
 */
import { loadEnvFiles } from './config/load-env-files';

/**
 * The files actually applied, in precedence order. Exported so `bootstrap()` can
 * log them once the logger exists.
 *
 * This is not decoration. `resolveEnvFiles` puts the CWD-local `.env` BEFORE the
 * workspace root's, and `process.loadEnvFile` does not overwrite a variable that
 * is already set, so the first file to define a key wins. `pnpm dev` runs `nest
 * start` from `apps/api`, which means a stray `apps/api/.env` silently beats the
 * repo root's for every key it happens to define, with nothing anywhere saying
 * so. That is not hypothetical: a three-month-old `apps/api/.env` left over from
 * the template era pinned `S3_BUCKET` to a bucket that no longer exists, and the
 * only symptom was every upload failing with `NoSuchBucket`.
 */
export const loadedEnvFiles = loadEnvFiles(process.cwd());

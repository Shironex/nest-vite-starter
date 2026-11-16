import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Resolves and loads the repo's `.env` files into `process.env`.
 *
 * This exists because two things read the environment BEFORE Nest's
 * `ConfigModule.forRoot({ envFilePath })` ever runs:
 *
 *   - `@repo/database` throws at module scope when `DATABASE_URL` is unset, and
 *     `main.ts` dynamic-imports it as the first statement of `bootstrap()`;
 *   - `./instrument.ts` reads `SENTRY_*` at module scope.
 *
 * Neither pnpm nor turbo populates the environment from a `.env` file, so on a
 * fresh clone the values only reach the process if the process loads them
 * itself. `ConfigModule` still owns validation and typed access; this only
 * makes sure the raw values are present early enough for the module-scope
 * readers above.
 *
 * Precedence, strongest first: the real process environment (container env,
 * CI step env, an exported shell var) > the nearest `.env` (the package dir
 * when turbo runs the task) > the workspace-root `.env` (the documented single
 * source of truth in `.env.example`). `process.loadEnvFile` never overwrites a
 * key that is already set, so loading nearest-first yields exactly that order.
 */

/** Identifies the monorepo root. Present in the repo and in the API image. */
const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

/**
 * Ancestor levels searched for the workspace marker. Bounded so a process
 * launched from outside the repo can never walk up into `$HOME` and pick up an
 * unrelated `.env`.
 */
const MAX_ANCESTOR_DEPTH = 8;

/** Nearest ancestor of `startDir` (inclusive) that holds the workspace marker. */
function findWorkspaceRoot(startDir: string): string | undefined {
  let dir = startDir;

  for (let depth = 0; depth <= MAX_ANCESTOR_DEPTH; depth += 1) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }

  return undefined;
}

/**
 * Existing `.env` files to load, nearest first.
 *
 * `startDir` is the launch cwd, which differs per mode: `apps/api` under
 * `turbo dev` / `pnpm --filter @repo/api dev`, the repo root for
 * `node apps/api/dist/src/main.js`, and `/app` in the production image (where
 * no `.env` is shipped, so this returns an empty list and the container
 * environment is used untouched).
 */
export function resolveEnvFiles(startDir: string): string[] {
  const candidates = [join(startDir, '.env')];

  const root = findWorkspaceRoot(startDir);
  if (root !== undefined && root !== startDir) {
    candidates.push(join(root, '.env'));
  }

  return candidates.filter((candidate) => existsSync(candidate));
}

/**
 * Loads every resolved `.env` into `process.env` and returns the paths applied.
 *
 * `load` is injectable for tests; production always uses Node's built-in
 * parser, which keeps this dependency-free (the repo pins node >= 22.22.1).
 */
export function loadEnvFiles(
  startDir: string,
  load: (path: string) => void = (path) => {
    process.loadEnvFile(path);
  },
): string[] {
  const loaded: string[] = [];

  for (const file of resolveEnvFiles(startDir)) {
    try {
      load(file);
      loaded.push(file);
    } catch {
      // An unreadable .env is a local-convenience failure, never a fatal one.
      // Every deployed mode gets its configuration from the real environment,
      // and ConfigModule's Joi schema still fails the boot closed if something
      // required is genuinely absent.
    }
  }

  return loaded;
}

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFiles, resolveEnvFiles } from './load-env-files';

/**
 * Guards the boot-time env cascade that `main.ts` imports above `./otel`.
 * Regression cover for the boot failure where nothing populated DATABASE_URL
 * before `@repo/database` read it at module scope, so the two properties that
 * matter here are (a) the workspace-root `.env` is found from the `apps/api`
 * cwd that turbo launches the task with, and (b) the walk is bounded so a
 * process started outside the repo never inherits a stray `.env`.
 */
describe('load-env-files', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'load-env-files-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  /** Builds `<tmp>/<dir>` and returns its absolute path. */
  const dir = (...segments: string[]): string => {
    const path = join(tmp, ...segments);
    mkdirSync(path, { recursive: true });
    return path;
  };

  const file = (path: string, name: string): string => {
    const full = join(path, name);
    writeFileSync(full, '');
    return full;
  };

  describe('resolveEnvFiles', () => {
    it('finds the workspace-root .env from a package directory', () => {
      const root = dir('repo');
      file(root, 'pnpm-workspace.yaml');
      const rootEnv = file(root, '.env');
      const api = dir('repo', 'apps', 'api');

      expect(resolveEnvFiles(api)).toEqual([rootEnv]);
    });

    it('prefers the package .env over the workspace-root .env', () => {
      const root = dir('repo');
      file(root, 'pnpm-workspace.yaml');
      const rootEnv = file(root, '.env');
      const api = dir('repo', 'apps', 'api');
      const apiEnv = file(api, '.env');

      // Nearest first: process.loadEnvFile keeps the first value it sees, so
      // this ordering IS the precedence contract.
      expect(resolveEnvFiles(api)).toEqual([apiEnv, rootEnv]);
    });

    it('returns the root .env once when launched from the workspace root', () => {
      const root = dir('repo');
      file(root, 'pnpm-workspace.yaml');
      const rootEnv = file(root, '.env');

      expect(resolveEnvFiles(root)).toEqual([rootEnv]);
    });

    it('returns nothing when the workspace ships no .env (the production image)', () => {
      const root = dir('app');
      file(root, 'pnpm-workspace.yaml');

      expect(resolveEnvFiles(join(root, 'apps', 'api'))).toEqual([]);
    });

    it('never walks past a directory that is not in a workspace', () => {
      // No pnpm-workspace.yaml anywhere, so the ancestor .env must be ignored
      // rather than leaking a stranger's file into the process environment.
      const outer = dir('outer');
      file(outer, '.env');
      const inner = dir('outer', 'inner');

      expect(resolveEnvFiles(inner)).toEqual([]);
    });
  });

  describe('loadEnvFiles', () => {
    it('loads every resolved file, nearest first, and reports what it applied', () => {
      const root = dir('repo');
      file(root, 'pnpm-workspace.yaml');
      const rootEnv = file(root, '.env');
      const api = dir('repo', 'apps', 'api');
      const apiEnv = file(api, '.env');
      const load = jest.fn();

      expect(loadEnvFiles(api, load)).toEqual([apiEnv, rootEnv]);
      expect(load.mock.calls).toEqual([[apiEnv], [rootEnv]]);
    });

    it('keeps booting when a file cannot be read', () => {
      const root = dir('repo');
      file(root, 'pnpm-workspace.yaml');
      const rootEnv = file(root, '.env');
      const api = dir('repo', 'apps', 'api');
      const apiEnv = file(api, '.env');
      const load = jest.fn((path: string) => {
        if (path === apiEnv) throw new Error('EACCES');
      });

      expect(loadEnvFiles(api, load)).toEqual([rootEnv]);
    });

    it('is a no-op with no .env present', () => {
      const root = dir('repo');
      file(root, 'pnpm-workspace.yaml');
      const load = jest.fn();

      expect(loadEnvFiles(root, load)).toEqual([]);
      expect(load).not.toHaveBeenCalled();
    });
  });
});

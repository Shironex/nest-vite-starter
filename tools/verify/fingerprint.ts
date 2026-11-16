import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * A verification result is only evidence about a tree. The fingerprint is HEAD
 * plus the content of every tracked and every untracked-but-not-ignored file,
 * so an uncommitted edit changes it and a gitignored build artifact does not.
 * `pnpm verify` takes it before and after the run: a run whose tree moved
 * underneath it proves nothing about either tree, and is reported blocked.
 */
export interface IFileDigest {
  readonly path: string;
  readonly sha: string;
}

export interface ITreeFingerprint {
  readonly commit: string;
  readonly fingerprint: string;
}

/** Order-independent digest over path/content pairs. */
export function hashEntries(entries: readonly IFileDigest[]): string {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    hash.update(entry.path);
    hash.update('\0');
    hash.update(entry.sha);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function listTrackedFiles(root: string): string[] {
  const out = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter((path) => path !== '');
}

function digestFile(root: string, path: string): IFileDigest | null {
  const full = join(root, path);
  try {
    // A submodule or a path deleted between the listing and the read is skipped
    // rather than thrown on: the point is to notice CHANGE, and both sides of
    // the comparison skip the same way.
    if (!statSync(full).isFile()) {
      return null;
    }
    return { path, sha: createHash('sha256').update(readFileSync(full)).digest('hex') };
  } catch {
    return null;
  }
}

export function headCommit(root: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function treeFingerprint(root: string): ITreeFingerprint {
  const entries = listTrackedFiles(root)
    .map((path) => digestFile(root, path))
    .filter((entry): entry is IFileDigest => entry !== null);

  return { commit: headCommit(root), fingerprint: hashEntries(entries) };
}

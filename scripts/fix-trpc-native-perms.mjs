// Restore the executable bit on the nestjs-trpc native CLI binaries.
//
// nestjs-trpc ships a per-arch native binary (used by `nestjs-trpc generate`,
// a turbo dependency of lint/check-types/build). The arm64-linux build of that
// binary is published WITHOUT the executable bit, so `nestjs-trpc generate`
// fails with EACCES when CI is run locally under `act` on Apple Silicon (the
// runner is arm64 Linux). GitHub's amd64 runners are unaffected because the
// x86_64 binary is shipped executable.
//
// This runs as a root `postinstall`, so it fires after every `pnpm install`
// (dev, CI, act). It is a best-effort, idempotent no-op everywhere except the
// one case it fixes: on macOS/amd64-Linux the binary is already +x (chmod to
// the same mode), and on Windows fs.chmod is effectively ignored. It never
// throws, so a missing dependency or path change can never break install.

import { chmodSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PNPM_DIR = join(process.cwd(), 'node_modules', '.pnpm');

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

let fixed = 0;

// node_modules/.pnpm/<nestjs-trpc@hash>/node_modules/nestjs-trpc/native/<arch>/<binary>
for (const pkg of safeReaddir(PNPM_DIR)) {
  if (!pkg.isDirectory() || !pkg.name.startsWith('nestjs-trpc@')) continue;

  const nativeDir = join(PNPM_DIR, pkg.name, 'node_modules', 'nestjs-trpc', 'native');
  for (const arch of safeReaddir(nativeDir)) {
    if (!arch.isDirectory()) continue;

    const archDir = join(nativeDir, arch.name);
    for (const entry of safeReaddir(archDir)) {
      if (!entry.isFile()) continue;
      const file = join(archDir, entry.name);
      try {
        const mode = statSync(file).mode;
        // Add owner/group/other execute bits; leave the rest of the mode as-is.
        const withExec = mode | 0o111;
        if (withExec !== mode) {
          chmodSync(file, withExec);
          fixed += 1;
        }
      } catch {
        // best-effort: ignore anything we cannot stat/chmod
      }
    }
  }
}

if (fixed > 0) {
  console.log(`[fix-trpc-native-perms] restored +x on ${fixed} nestjs-trpc native binary file(s)`);
}

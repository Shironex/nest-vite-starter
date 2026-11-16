# CLAUDE.md

Follow [AGENTS.md](./AGENTS.md). That file is the contract (worktree bootstrap, the gate, commit
rules, house rules, the docs index); this file is Claude-only wiring. If the docs and the lint
config disagree, the lint config wins.

## Project hooks (`.claude/settings.json`, tracked)

Every checkout and worktree inherits two edit-time hooks from `scripts/hooks/`. They add no policy: they mirror
rules `turbo lint` and `pnpm lint:meta` already enforce.

- `guard-edit.mjs` (PreToolUse on Edit, Write, MultiEdit) denies an edit that adds a NEW `as any`,
  `@ts-ignore`, `@ts-expect-error`, inline `eslint-disable` or empty `catch {}` in the source files
  lint-meta scans (`apps|packages/*/{src,test,tests,security-spec}`, `.ts`/`.tsx`, not
  generated). A denied edit is not applied: fix the underlying problem and retry; do not reword
  the pattern to slip past it.
  Moving an existing match is fine.
- `lint-edited.mjs` (PostToolUse) runs ESLint on the file you just wrote and returns any problems
  as feedback. The write is already done: fix what it lists before moving on. It skips silently when
  ESLint cannot answer (for example the internal plugin is not built yet: `pnpm build:packages`).

The hooks add to, and never replace, the hooks in `~/.claude/settings.json` and
`.claude/settings.local.json` (untracked, machine-specific; do not edit it for project behavior).
Their unit tests: `node --test "scripts/hooks/*.test.mjs"`.

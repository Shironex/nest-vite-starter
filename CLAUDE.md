# CLAUDE.md

Follow [AGENTS.md](./AGENTS.md): it holds the bootstrap steps, the dev ports, the gate, the commit
rules and the conventions. If the docs and the lint config disagree, the lint config wins.

Claude-specific notes:

- Run builds and tests through `pnpm exec turbo ...`, and stop dev servers by PID: a worktree path
  contains "vite", so `pkill vite` would stop other checkouts.
- Husky hooks run on every commit. Fix what they report; do not bypass them with `--no-verify`.
- This repo has no `.claude/` hooks or settings on purpose. Do not add them without being asked.

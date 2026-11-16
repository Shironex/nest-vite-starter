## Summary

<!-- 1 to 3 bullets: what changed and why. -->

## Test plan

- [ ] Pre-push gate passes locally (build, `turbo lint`, `turbo check-types`, `pnpm lint:meta`, knip, coverage ratchet)
- [ ] New or changed behavior is covered by tests
- [ ] Database touched? Migration added and `db:migrate:status` is clean

## Checklist

- [ ] Conventional commit messages with a valid scope
- [ ] No `any`, no inline `eslint-disable`, no `@ts-ignore`
- [ ] New env vars added to `.env.example` and the env validator
- [ ] Docs updated when behavior or contracts changed

## Screenshots

<!-- Required for UI changes. -->

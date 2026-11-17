# Dependency overrides

Why each entry in the root `package.json` `pnpm.overrides` exists. Add a row when you add an
override, and delete the row with it. Security floors can go once `pnpm why <name>` shows no copy
below the patched version without the override and `pnpm audit --prod --audit-level=high` stays clean.

## Single-version pins

Two copies of these break at runtime in ways no advisory feed reports.

| Override         | Why                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------ |
| `@nestjs/common` | One Nest runtime across `apps/api` and `packages/shared` (one DI metadata registry). |
| `@nestjs/core`   | Same policy as `@nestjs/common`; also the floor for GHSA-36xv-jgw5-4q75 (11.1.18).   |
| `ioredis`        | One client for sessions, BullMQ and the rate limiter (one pool, one client type).    |
| `react`          | One React across `apps/web` and `packages/ui`, or hooks break.                       |
| `react-dom`      | Moves with `react`.                                                                  |

## Security floors

Each lifts a transitive dependency to the first patched release of an advisory.

| Override                         | Advisory                                       | Reached through                        |
| -------------------------------- | ---------------------------------------------- | -------------------------------------- |
| `deepmerge-ts@<8.0.0`            | GHSA-ggr8-5vv4-36mx                            | prisma > @prisma/config (exact 7.1.5)  |
| `brace-expansion@>=5.0.0 <5.0.9` | GHSA-rgw5-rvv9-x895                            | eslint > minimatch                     |
| `ip-address@>=10.1.1 <=10.2.1`   | GHSA-4xrf-jv44-h6hh, GHSA-22jq-vg5j-6vgg       | socks / proxy agents                   |
| `esbuild@>=0.27.3 <0.28.1`       | GHSA-g7r4-m6w7-qqqr                            | tsup, vite                             |
| `find-my-way@<=9.6.0`            | GHSA-c96f-x56v-gq3h                            | Fastify router chain                   |
| `js-yaml@<4.3.2`                 | GHSA-2883-xcg3-v3hh                            | @commitlint/cli > cosmiconfig          |
| `tmp@<0.2.6`                     | GHSA-ph9p-34f9-6g65                            | external-editor                        |
| `uuid@<11.1.1`                   | GHSA-w5hq-g745-h8pq                            | older dev tooling                      |
| `valibot@<=1.4.1`                | GHSA-5qjj-4xww-7phc                            | transitive                             |
| `fast-uri@<3.1.6`                | four high advisories (GHSA-5jgf-p345-68v8 ...) | @commitlint/cli > ajv                  |
| `mysql2@<3.23.1`                 | GHSA-rgwj-5xj2-c3m3                            | prisma driver adapters (never run)     |
| `multer@<2.3.0`                  | three advisories (GHSA-wc9g-mqfw-jrwm ...)     | @nestjs/platform-express (exact 2.2.0) |
| `qs@<6.16.0`                     | GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g       | express                                |
| `ws@>=8.0.0 <8.21.0`             | GHSA-96hv-2xvq-fx4p                            | transitive (the 7.x copy is left out)  |

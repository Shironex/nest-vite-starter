# syntax=docker/dockerfile:1.7
#
# Every stage runs on Debian slim rather than Alpine. `pnpm turbo build
# --filter=@repo/api` depends on `@repo/api#generate:trpc`, which executes the
# native nestjs-trpc CLI, and that binary is linked against glibc:
#
#   native/aarch64-unknown-linux-gnu/nestjs-trpc: ELF 64-bit LSB pie executable,
#   ARM aarch64, dynamically linked, interpreter /lib/ld-linux-aarch64.so.1,
#   for GNU/Linux 2.0.0
#
# Alpine ships musl and has no such loader, so execve returns ENOENT on every
# architecture (the file is there and executable, the interpreter is not). The
# runtime stages stay on the same base as the builder so the glibc build of
# @node-rs/argon2 that pnpm installs here keeps working once node_modules is
# copied forward.
#
# Debian 13 (trixie), not 12: the x86_64 nestjs-trpc binary needs GLIBC_2.39,
# and bookworm ships 2.36, so generate:trpc fails on amd64 builders.
#
# Node 26 images no longer bundle corepack, so pnpm comes from npm, pinned to the
# `packageManager` version in package.json. It is only needed by the build stages:
# the runtime image runs plain node and the Prisma CLI, never pnpm.
#
# HUSKY=0: a dependency install runs the root `prepare` script, which invokes husky
# and fails without a .git directory (.dockerignore excludes it).
#
# Stage 1: Install dependencies
FROM node:26-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS deps
ENV HUSKY=0
RUN npm install --global pnpm@12.18.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# A `pnpm patch` lists its file in the workspace config, and a frozen install
# refuses to run when a listed patch file is missing from the context. The folder
# always exists (patches/.gitkeep), so this COPY never fails.
COPY patches/ ./patches/
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY packages/email/package.json ./packages/email/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
# The root postinstall (scripts/fix-trpc-native-perms.mjs) fires on every
# `pnpm install`, so the script has to be in the context before the install
# layer or the build dies with MODULE_NOT_FOUND. It also does real work here:
# nestjs-trpc publishes native/aarch64-unknown-linux-gnu/nestjs-trpc with mode
# 0644, so without it the arm64 image fails generate:trpc with EACCES.
COPY scripts/ ./scripts/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:26-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS builder
ENV HUSKY=0
RUN npm install --global pnpm@12.18.0
WORKDIR /app
COPY --from=deps /app ./
COPY . .
# prisma.config.ts refuses to load without DATABASE_URL, even for `prisma
# generate`, which never connects. A placeholder on the build steps only, so it
# never reaches the runtime image.
ARG BUILD_DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN DATABASE_URL=$BUILD_DATABASE_URL pnpm --filter @repo/database db:generate
RUN DATABASE_URL=$BUILD_DATABASE_URL pnpm turbo build --filter=@repo/api

# Stage 3: Production runtime
# Runs as uid/gid 10001 (created below, no shell, no home). The same image serves
# the api (default command) and the one-shot migration (`api-entrypoint migrate`,
# used by docker-compose.prod.yml), so a deploy never ships two builds that could
# drift. wget is not in node:26-trixie-slim and the HEALTHCHECK below
# calls it.
FROM node:26-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS runner
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini wget \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid 10001 --no-create-home \
         --home-dir /nonexistent --shell /usr/sbin/nologin app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/database/generated ./packages/database/generated
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/database/package.json ./packages/database/
# What `prisma migrate deploy` reads: the config, the schema folder, the
# migrations, and the CLI in this package's own node_modules.
COPY --from=builder /app/packages/database/prisma.config.ts ./packages/database/
COPY --from=builder /app/packages/database/prisma ./packages/database/prisma
COPY --from=builder /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/packages/email/dist ./packages/email/dist
COPY --from=builder /app/packages/email/package.json ./packages/email/
COPY --from=builder /app/packages/email/node_modules ./packages/email/node_modules
# pnpm links each workspace package's dependencies into its own node_modules (symlinks
# into /app/node_modules/.pnpm, so cheap) and hoists nothing to the root: every
# package copied above needs its node_modules, or the boot dies with
# `Cannot find module 'zod'`.
COPY --from=builder /app/node_modules ./node_modules
COPY package.json pnpm-workspace.yaml ./
COPY --chmod=0755 apps/api/docker/entrypoint.sh /usr/local/bin/api-entrypoint
# Prisma and other tools write caches under $HOME or XDG_CACHE_HOME; with a read-only
# root filesystem the only writable place is the tmpfs on /tmp.
ENV HOME=/tmp XDG_CACHE_HOME=/tmp
EXPOSE 3000
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health/ready || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/api-entrypoint"]
CMD ["node", "apps/api/dist/src/main.js"]

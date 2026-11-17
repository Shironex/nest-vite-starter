# syntax=docker/dockerfile:1.7
#
# Node 26 images no longer bundle corepack, so pnpm comes from npm, pinned to the
# `packageManager` version in package.json. HUSKY=0: the root `prepare` script runs
# husky, which fails without a .git directory (.dockerignore excludes it).
#
# Stage 1: Install + Build
#
# Debian slim, not Alpine. `pnpm --filter @repo/api generate:trpc` below (and
# @repo/web#build, which depends on it through the turbo graph) runs the native
# nestjs-trpc CLI, and that binary is linked against glibc:
#
#   native/aarch64-unknown-linux-gnu/nestjs-trpc: ELF 64-bit LSB pie executable,
#   ARM aarch64, dynamically linked, interpreter /lib/ld-linux-aarch64.so.1,
#   for GNU/Linux 2.0.0
#
# Alpine ships musl and has no such loader, so execve returns ENOENT on every
# architecture. The runner below stays on Alpine: it only serves static files
# and never loads anything from node_modules.
#
# Debian 13 (trixie), not 12: the x86_64 nestjs-trpc binary needs GLIBC_2.39,
# and bookworm ships 2.36, so generate:trpc fails on amd64 builders.
FROM node:26-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS builder
ENV HUSKY=0
RUN npm install --global pnpm@12.18.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# A `pnpm patch` lists its file in the workspace config, and a frozen install
# refuses to run when a listed patch file is missing from the context. The folder
# always exists (patches/.gitkeep), so this COPY never fails.
COPY patches/ ./patches/
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY packages/email/package.json ./packages/email/
COPY packages/ui/package.json ./packages/ui/
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
COPY . .
RUN pnpm --filter @repo/api generate:trpc
# No VITE_* build arguments: every public value (API_URL, TURNSTILE_SITE_KEY,
# SENTRY_DSN, APP_NAME) is runtime config, written to /config.js when the
# container starts, so one image serves every environment.
# prisma.config.ts refuses to load without DATABASE_URL, even for `prisma
# generate`, which never connects. A placeholder on the build steps only, so it
# never reaches the runtime image.
ARG BUILD_DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN DATABASE_URL=$BUILD_DATABASE_URL pnpm turbo build --filter=@repo/web

# Stage 2: Serve with nginx-unprivileged as uid/gid 10001 (the image's own user is
# 101). The process needs to READ the site and write only under /tmp (pid file,
# temp paths, the runtime config), so the files can stay root-owned and the image
# runs with a read-only root filesystem plus a tmpfs on /tmp.
FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6 AS runner
USER root
RUN addgroup -g 10001 -S app \
    && adduser -u 10001 -S -G app -H -h /nonexistent -s /sbin/nologin app
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/docker/snippets/ /etc/nginx/snippets/
COPY --chmod=0755 apps/web/docker/10-write-config.sh /docker-entrypoint.d/10-write-config.sh
EXPOSE 8080
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1
# This image serves the SPA. Set API_UPSTREAM (for example http://api:3000) to have
# it forward /trpc and /api to the api on the same origin; otherwise a router in
# front of it must do that (see docs/deploy-coolify.md).

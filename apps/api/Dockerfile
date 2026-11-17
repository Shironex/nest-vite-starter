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
# Stage 1: Install dependencies
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS deps
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
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
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS builder
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /app
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @repo/database db:generate
RUN pnpm turbo build --filter=@repo/api

# Stage 3: Migrate one-shot
# Used by docker-compose.prod.yml as a `restart: "no"` service that runs
# `prisma migrate deploy` against the live DB before the api container starts.
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS migrate
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /app/packages/database
COPY --from=builder /app/packages/database/package.json ./
COPY --from=builder /app/packages/database/prisma ./prisma
COPY --from=builder /app/packages/database/generated ./generated
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages/database/node_modules ./node_modules
ENV NODE_ENV=production
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "exec", "prisma", "migrate", "deploy", "--schema=prisma/schema"]

# Stage 4: Production runtime
# wget is not in node:22-slim and the HEALTHCHECK below, plus the one
# docker-compose.prod.yml declares for this service, both call it.
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS runner
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini wget \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/database/generated ./packages/database/generated
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/database/package.json ./packages/database/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/email/dist ./packages/email/dist
COPY --from=builder /app/packages/email/package.json ./packages/email/
COPY --from=builder /app/node_modules ./node_modules
COPY package.json pnpm-workspace.yaml ./
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api/dist/src/main.js"]

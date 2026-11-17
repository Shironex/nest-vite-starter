# Deploying on Coolify

A recipe for a self-hosted [Coolify](https://coolify.io) instance. Hostnames below
are placeholders: `app.example.com` for the web and `api.example.com` for the api.
Replace them with your own.

The repo ships two Dockerfiles (`apps/api/Dockerfile`, `apps/web/Dockerfile`), both
running as uid 10001, and a self-host compose file (`docker-compose.prod.yml`). There
are two ways to deploy: separate applications (below, the default) or one Docker
Compose resource (the last section).

## What the images expect

| Image | Port | Health check    | Configured by                                                                                                       |
| ----- | ---- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| api   | 3000 | `/health/ready` | Environment: the keys in `.env.example`, validated at boot by `apps/api/src/config/env.ts`                          |
| web   | 8080 | `/healthz`      | Runtime environment (no build arguments): `API_URL`, `API_UPSTREAM`, `TURNSTILE_SITE_KEY`, `SENTRY_DSN`, `APP_NAME` |

The web image writes `/config.js` from its environment when the container starts, so
changing a web value is a restart, not a rebuild. The api runs `prisma migrate deploy`
in its entrypoint before it starts (set `RUN_MIGRATIONS=false` to skip it).

## 1. Project, network and databases

1. Create a new **Project** and, on the server, a **destination network** for it (a
   Docker network of its own, for example `net-starter`). Everything below goes on that
   destination so the services resolve each other by name.
2. Add a standalone **PostgreSQL 18** database on that destination. Note the internal
   connection URL Coolify shows. If the fork holds real data, turn on scheduled backups
   to S3.
3. Add a standalone **Valkey** database on that destination (image
   `valkey/valkey:9-alpine`; it runs `redis-server` style commands unchanged). Note its
   internal URL, with the password.

## 2. The api

Create an **Application** from the Git repository.

- Build pack: **Dockerfile**. Dockerfile location: `apps/api/Dockerfile`. Base
  directory: `/` (the build needs the whole workspace).
- Port: `3000`. Health check path: `/health/ready`.
- Same destination network as the databases.
- Environment (runtime). Start from `.env.prod.example`; the api refuses to start
  and lists every bad key when something breaks its rules:
  - `NODE_ENV=production`
  - `DATABASE_URL` and `REDIS_URL`: the internal URLs from step 1
  - `APP_URL=https://app.example.com` (the public web origin)
  - `CORS_ORIGINS`: leave empty when the web proxies the api on its own origin
  - `CSRF_SECRET` (`openssl rand -hex 32`) and `ENCRYPTION_KEY` (`openssl rand -base64 32`)
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, with
    `SMTP_REQUIRE_TLS=true`
  - `TURNSTILE_SECRET_KEY`, or `CAPTCHA_DISABLED=true` to run without a captcha
  - `TRUST_PROXY=1`: one proxy (Traefik) sits in front of the api. Use `2` when the
    web container proxies to the api and the browser reaches the web through Traefik
    (see step 3). Never `true`.
- Migrations: the container runs `prisma migrate deploy` before `node apps/api/dist/src/main.js`.
  That is safe with **one replica**. With more replicas set `RUN_MIGRATIONS=false` and
  run the migration once per deploy instead (see "Migrations" below).

### Migrations

Coolify's **pre-deployment command** runs inside the currently running container, and
only after the deployment workspace is prepared and before the new container is
started (a failure stops the deployment; on the very first deployment, with no running
container, it is skipped). So it migrates with the OLD image's migration files, which
is not what you want: a new migration ships in the new image. That is why the
entrypoint, which runs in the new container, is the default home for `migrate deploy`.
Source: the "Pre-deployment command" section of Coolify's application settings
documentation (<https://coolify.io/docs/applications/configuration/general>).

For several replicas, run `api-entrypoint migrate` from the new image as a one-shot
step (the `migrate` service of `docker-compose.prod.yml` does exactly that), or use a
**post-deployment** command and accept that the old schema serves traffic until it
finishes (keep migrations additive, see `docs/migration-playbook.md`).

## 3. The web

Create a second **Application** from the same repository.

- Build pack **Dockerfile**, location `apps/web/Dockerfile`, base directory `/`.
- Port `8080`. Health check path `/healthz`. Domain `https://app.example.com`.
- Same destination network.
- Runtime environment (not build arguments):
  - `API_UPSTREAM=http://<api-service-name>:3000`, the api's internal address, so the
    web forwards `/trpc` and `/api` to it on its own origin. This is the simplest setup:
    cookies and the CSRF origin check need nothing extra. Leave `API_URL` empty.
    The web passes the `X-Forwarded-Proto` that Traefik (or a tunnel) sets on to the
    api, so the api sees `https` although TLS ended before the web. Only `http` and
    `https` pass; without the header the web sends its own scheme (`http`). Keep the
    web reachable only through that proxy, or a client could claim `https` itself.
    The api's cookies do not depend on it (they are `Secure` whenever
    `NODE_ENV=production`), and `TRUST_PROXY` must count the web as a hop.
  - Alternatively serve the api on `https://api.example.com` and set
    `API_URL=https://api.example.com` (an origin, no path) instead. Then
    `APP_URL` and `CORS_ORIGINS` on the api must name the web origin, and cookies cross
    origins, so test login before relying on it. The web refuses to start on an
    `API_URL` or `API_UPSTREAM` that is not a plain origin.
  - `TURNSTILE_SITE_KEY` (public key), `SENTRY_DSN` (public DSN, optional) and
    `APP_NAME` (optional).

## 4. Behind a Cloudflare Tunnel

When `cloudflared` runs on the host and points at `localhost:<hostPort>`, the published
port is what the tunnel reaches, so bind it to loopback:

1. In the application's settings set the port mapping to `127.0.0.1:<host>:<container>`
   (for example `127.0.0.1:8080:8080`) and redeploy. Coolify's UI accepts that form; its
   REST API and CLI reject it, so it has to be set in the dashboard.
2. Docker-published ports bypass `ufw`, so a firewall rule is not evidence the port is
   closed. Verify with three checks:
   - host bind: `ss -tulpn | grep <host port>` shows `127.0.0.1`, not `0.0.0.0`
   - the public IP does not answer on that port
   - the public hostname through Cloudflare answers `200`
3. With the tunnel in front of Traefik (or of the web directly) the chain has one more
   hop: raise `TRUST_PROXY` by one so the api still sees the client's address.

## 5. Watch paths

Limit what triggers a deploy:

| Application | Watch paths                  |
| ----------- | ---------------------------- |
| api         | `apps/api/**`, `packages/**` |
| web         | `apps/web/**`, `packages/**` |

A change to only a Dockerfile in another place, or to the root lockfile, may need a
manual deploy.

## Alternative: one Docker Compose resource

Paste `docker-compose.prod.yml` as a **Docker Compose** resource instead. Everything
(web, api, migrate, Postgres, Valkey) lives in one resource and resolves by service
name. Adapt it for Coolify:

- Remove the `ports:` of `web` and `api` and let Coolify route: declare
  `SERVICE_FQDN_WEB_8080` (and, if the api has its own domain, `SERVICE_FQDN_API_3000`)
  with no value, and Coolify generates the domain and the proxy route.
- Replace the passwords with generated ones: `SERVICE_PASSWORD_POSTGRES`,
  `SERVICE_PASSWORD_REDIS`, used in the compose file in place of `POSTGRES_PASSWORD`
  and `REDIS_PASSWORD`.
- Each Coolify resource gets its own isolated network, so keep the services that talk to
  each other in this one resource.
- Coolify turns file bind mounts into empty directories. Inline any config file with a
  top-level `configs:` block using `content:`, escape a literal `$` as `$$`, and avoid
  `${...}` even in a comment there (it is interpolated). A `content:` file is written
  once per target path and never updated by a later change, so put a version in the
  target path.
- Deploy published images with `pull` then `up -d --no-build`, never a plain `up` (the
  `image:` plus `build:` trap described in the compose file's header).

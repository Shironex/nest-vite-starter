# Security Policy

`nest-vite-starter` is an open-source starter. It ships authentication, sessions, two-factor
and an audit trail that products built on it will run in production, so security reports are welcome
and handled privately until a fix is available.

## Reporting a vulnerability

Do not open a public issue, discussion or pull request for an unfixed vulnerability.

Report it privately through GitHub private vulnerability reporting: open the repository's
**Security** tab and choose **Report a vulnerability**, or go directly to
[github.com/Shironex/nest-vite-starter/security/advisories/new](https://github.com/Shironex/nest-vite-starter/security/advisories/new).

Include where possible:

- The affected area (api, web, or a package).
- Steps to reproduce, or a proof of concept.
- The impact you observed (data exposure, auth bypass, privilege escalation, and so on).

Maintainers acknowledge reports as soon as they can, coordinate a fix in a private advisory, and
credit the reporter in the published advisory unless you ask otherwise.

## Supported versions

Only the latest `main` branch is supported. There are no release branches and no long-term-support
line: fixes land on `main`.

A project created from this starter is a fork with its own lifecycle. Its maintainers are
responsible for pulling in upstream fixes and for the security of their own deployments
(infrastructure, secrets, backups, TLS, access control). Report vulnerabilities in a derived
product to that product's maintainers, not here, unless the flaw is in code inherited from the
starter.

## Automated scanning

- `gitleaks` scans for committed secrets on every push, every pull request, and a weekly cron
  (`.github/workflows/secrets.yml`). A finding fails the job; the SARIF report is kept
  as a workflow artifact.
- The husky pre-push hook (`.husky/pre-push`) runs gitleaks over the pushed commits when gitleaks
  is installed, so secrets are caught before they leave a developer machine.
- `pnpm audit --prod --audit-level=high` gates dependency vulnerabilities in CI, and a weekly
  `pnpm audit --prod` runs on a schedule (`.github/workflows/audit.yml`). Renovate opens update
  pull requests (after a 7-day release age) that run the full CI; GitHub's Dependabot security
  alerts stay on.
- GitHub secret scanning and push protection should be enabled on the repository (and on your
  fork): they are free for public repositories.

## Handling secrets

Never commit real credentials. `.env.example` holds placeholder values only; the
boot-time environment validator rejects known placeholders in production. If a secret is ever
committed, rotate it immediately (removing it from history is not enough) and report it through
the advisory path above.

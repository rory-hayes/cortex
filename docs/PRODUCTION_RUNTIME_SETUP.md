# Production Runtime Setup

This checklist covers the runtime credentials required before authenticated production testing.
It intentionally uses placeholders only. Do not commit real credentials, Supabase API keys,
database URLs, GitHub private keys, Auth0 keys, webhook secrets, or local env files.

## Required Vercel Environment Variables

Set these in the production deployment environment:

- `WEB_BASE_URL` - HTTPS URL for the deployed Cortex app.
- `APP_BASE_URL` - HTTPS Auth0 application base URL used for callbacks and logout.
- `AUTH0_DOMAIN` - Auth0 tenant domain as a hostname, without protocol or path.
- `AUTH0_CLIENT_ID` - Auth0 application client id.
- `AUTH0_CLIENT_SECRET` - Auth0 application client secret, stored as a server-side value.
- `AUTH0_SECRET` - 64-character hex string used to encrypt the session cookie.
- `DATABASE_URL` - Supabase Postgres connection string with the real database password.
- `GITHUB_APP_ID` - Numeric GitHub App id.
- `GITHUB_APP_PRIVATE_KEY` - GitHub App PEM private key, stored as a server-side value.
- `GITHUB_WEBHOOK_SECRET` - GitHub webhook signing secret.

Optional Linear sync values:

- `LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY`
- `LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY_ID`

Optional verification-only values:

- `SUPABASE_URL` - Supabase project API URL for endpoint smoke checks. Do not include API
  keys, database passwords, query strings, or fragments.

## Supabase Boundary

Cortex currently uses Supabase as Postgres through server-side `DATABASE_URL`.
The web app does not require Supabase publishable keys or secret keys in browser-visible
environment variables for the MVP runtime.

The Supabase REST URL and API keys cannot be used to recover or replace `DATABASE_URL`.
They can verify project API reachability, but authenticated dashboard/database work still
requires a Postgres connection string with the real database password. For an existing
Supabase project, get the connection string from the Dashboard Connect panel and reset the
database password in Database Settings if the current password is unknown.

Supabase anon or publishable keys are browser-visible API keys for public REST/Auth flows.
Supabase service-role keys are privileged server-only REST keys and must never be exposed
through `NEXT_PUBLIC_*`, client bundles, screenshots, or logs. The current MVP runtime does
not require a service-role key because repository scanning and dashboard persistence use
server-side Postgres through `DATABASE_URL`, not Supabase REST writes.

Local Supabase link can be created without committing or storing the remote database password
in the repository. Linked migration history can be checked as safe version ids, but direct
database verification and applying canonical package migrations still require the remote
Postgres password. Use a placeholder command shape only when documenting or rehearsing
password-backed database release checks:

```bash
supabase migration list --linked --password <remote-db-password>
```

Canonical SQL migrations remain in `packages/db/migrations`, with Drizzle metadata in
`packages/db/migrations/meta`. Do not transfer migration ownership into
`supabase/migrations` unless the project explicitly changes migration strategy.

## Safe Verification

After setting production credentials outside the repository, verify readiness without
printing secret values:

- Run `pnpm release-readiness:check` for the combined safe release gate. It runs local
  runtime environment checks, Vercel production environment variable names, deployed route
  smoke, Supabase link, Supabase migration history, direct database connectivity, and
  Supabase endpoint checks through one status report without printing secret values,
  Supabase refs, database URLs, API keys, private keys, response bodies, or local paths. Use
  `pnpm release-readiness:check --json` when automation needs structured output.
- Run `pnpm vercel-production-env:check` to compare Vercel production environment variable
  names against the required runtime set. The command prints only variable names and
  statuses, never environment values. Use `pnpm vercel-production-env:check --json` when
  automation needs structured output.
- Run `pnpm production-runtime:check` in an environment that has the production values
  loaded. The command prints only variable names, statuses, and safe messages. Use
  `pnpm production-runtime:check --json` when automation needs structured output.
- Run `pnpm production-smoke:check --url <deployed-app-url>` to verify the public route,
  sign-up redirect, and protected dashboard route without printing response bodies. In the
  current production deployment, Auth0 routes should redirect to Auth0 with a dashboard
  return target; if Auth0 runtime variables are absent, auth routes may report blocked or
  warning-only.
- Run `pnpm supabase-link:check` to verify this worktree has local Supabase config and
  a local link marker without printing project refs, local paths, passwords, or API keys.
  If it is blocked, run `supabase link --project-ref <project-ref>` and leave the password
  prompt blank when you only need local link metadata. Provide the remote database password
  only for explicit direct database verification or migration apply steps.
- Run `pnpm supabase-migrations:check` to compare canonical local package migration IDs
  with linked remote migration history without printing raw CLI output, database URLs,
  project refs, passwords, API keys, or local paths. This command reports whether the
  linked database is missing a package migration, but it does not apply migrations.
- Run `pnpm supabase-db:check` after loading the real `DATABASE_URL` in the shell to verify
  direct Postgres connectivity with a single `psql` query. The command uses the database
  URL only from the environment and prints only statuses, never database URLs, passwords,
  hosts, query output, or raw `psql` errors.
- Run `pnpm supabase-smoke:check --url <supabase-project-url-or-rest-url>` to verify
  Supabase REST/Auth endpoint reachability without printing response bodies, API keys, or
  the project ref. The command treats API-authenticated REST responses as reachable and
  does not verify table grants, migrations, or direct Postgres access.
- Confirm the deployed public route loads.
- Confirm protected routes no longer return the missing-Auth0 503 response.
- Confirm server-side database access works through `DATABASE_URL`.
- Confirm the GitHub App installation can list repositories and create setup PRs in the
  approved metadata-only flow.
- Confirm repo-readiness scans, findings, task recommendations, Cortex Tasks, setup PRs,
  and optional runner queueing work against the chosen test repository.

The source guard for this checklist is `apps/web/src/runtime/env.test.ts`; it verifies
the required runtime keys, placeholder rejection, optional Linear handling, and sanitized
readiness output.

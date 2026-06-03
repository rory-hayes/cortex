# Supabase Local Setup

This directory exists so the repository is initialized for Supabase CLI workflows.

Current state:

- `config.toml` is local development configuration only.
- The local project id is `cortex`.
- Generated Supabase `.temp` state and local env files are ignored.
- The Supabase CLI can see the hosted Cortex project when the local CLI profile is authenticated.
- The local worktree is linked to the hosted Cortex project without storing the remote
  database password in the repository.

Database migrations:

- Canonical SQL migrations live in `packages/db/migrations`.
- Drizzle migration metadata lives in `packages/db/migrations/meta`.
- Do not copy migrations into `supabase/migrations` unless the project intentionally changes migration ownership.

Remote database release verification still required:

- The local link marker is present, and `pnpm supabase-migrations:check` can read linked
  remote migration history as safe version ids.
- Direct database checks and applying canonical package migrations still need the remote
  Postgres password and the approved database release flow.
- Do not commit Supabase API keys, database URLs, service role keys, or local env files.

Local checks:

- `supabase migration list --local` requires local Supabase services to be running.
- If the local services are not running, the command is expected to fail on the local Postgres port.
- `pnpm supabase-migrations:check` compares `packages/db/migrations` with linked remote
  migration history using safe counts and version ids only. It does not apply migrations.

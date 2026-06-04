# Production E2E Recovery Report

Last updated: June 4, 2026

## Scope

This recovery pass handled the replacement Supabase project, production database wiring,
Auth0 route smoke, and release-readiness validation for Cortex. The report intentionally
omits database URLs, passwords, Supabase keys, Auth0 secrets, GitHub private keys, webhook
secrets, response bodies, local paths, and raw provider output.

## Findings

- The replacement Supabase project started without the Cortex control-plane schema.
- The local machine does not have `psql`, so the previous direct database readiness check
  could not prove connectivity even when a valid `DATABASE_URL` was available.
- The Vercel env apply helper could only apply all missing required keys together, which was
  too broad for a single recovered value such as `DATABASE_URL`.
- Auth0 production route smoke is ready: the public route is reachable, sign-up redirects to
  Auth0 with a dashboard return target, and the protected dashboard route no longer returns a
  missing-auth configuration response.
- Full production GitHub-connect/setup-PR E2E is still blocked because the GitHub App id,
  private key, and webhook secret are not configured in Vercel production.
- Supabase publishable and secret REST keys were not added to the app. The MVP runtime uses
  server-side Postgres through `DATABASE_URL`, not Supabase REST writes.

## Fixes Applied

- Applied canonical package migrations `0000` through `0022` to the replacement Supabase
  project through a temporary Supabase CLI migration layout.
- Relinked local Supabase generated state to the replacement project without committing
  generated link files or credentials.
- Added a Node Postgres fallback to `pnpm supabase-db:check` so direct database connectivity
  can be verified on machines without `psql`.
- Added `pnpm vercel-production-env:apply --key <required-key>` so operators can apply one
  recovered required production value without loading unrelated missing credentials.
- Added `pnpm github-app:check` and wired GitHub App runtime identity verification into the
  combined release-readiness gate without printing private keys, JWTs, webhook secrets, raw
  GitHub errors, or response bodies.
- Applied `DATABASE_URL` to Vercel production through the safe env helper, sending the value
  through stdin and printing only key names/statuses.
- Updated production runtime documentation, release notes, README, SPRINT, and BACKLOG status.

## Verification

- Supabase link check: ready.
- Supabase migration history: ready, with local and remote history through `0022`.
- Supabase endpoint smoke: ready, with REST/Auth endpoints reachable and API-auth gated.
- Direct Supabase database check: ready through the server-side Postgres client fallback.
- Vercel production env-name check: Auth0 and `DATABASE_URL` configured; GitHub App runtime
  credentials missing.
- Production deploy: `vercel --prod --yes` completed and aliased the deployment to the stable
  production URL.
- Production route smoke: ready for public route, Auth0 sign-up redirect, and protected route
  missing-config regression.
- Browser smoke: the production homepage renders as `AI Engineering Control Plane`, exposes
  sign-in/sign-up links, and the sign-up path redirects to the configured Auth0 tenant's signup
  screen. The dashboard return target is validated by the HTTP smoke check.
- Combined release-readiness gate: includes the GitHub App runtime identity section and is
  blocked only by required GitHub App runtime credentials, with optional Linear warnings.
- Repository validation: `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and
  `pnpm test` passed.
- Production build: `pnpm run build` passed; local build emitted expected Auth0 warnings because
  production Auth0 values were not loaded into the local shell for the build process.

## Remaining Work

- Configure `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET` in Vercel
  production.
- Run `pnpm github-app:check` with those values loaded in the shell to verify local JWT signing
  and GitHub App identity before redeploying.
- Redeploy production after the remaining GitHub App values are configured.
- Rerun production GitHub-connect/setup-PR E2E once those credentials are available.
- Complete a signed-in browser walkthrough with a real Auth0 test user: sign in, create/select
  a workspace in the fresh database, connect GitHub, run a readiness scan, approve a setup task,
  and create a setup PR.

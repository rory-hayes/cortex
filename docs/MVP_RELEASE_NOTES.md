# Cortex MVP Release Notes

Last updated: June 4, 2026

These notes describe the Cortex MVP release candidate after the repo-readiness refactor. Cortex now starts with a hosted GitHub repo-readiness flow, turns approved findings into Cortex Tasks, supports setup PRs for AI-readiness work, and keeps source-changing implementation behind the optional local runner.

The runner is the executor; the web app is the coordinator. The hosted app stores metadata and audit evidence only. Raw source code, diffs, patches, code snippets, `.env` contents, secrets, private keys, and unredacted command output must not cross into hosted payloads.

## Release Candidate Status

Automated MVP validation passed in `RFB-088`, and the latest `RFB-081` security-hardening validation re-ran the full root suite after token-storage and runner timeout cleanup hardening:

- Focused repo-readiness/setup PR/local runner/protocol/browser/checklist E2E coverage passed.
- Focused security-boundary coverage passed.
- `pnpm run typecheck` passed.
- `pnpm run lint` passed.
- `pnpm run format:check` passed.
- `pnpm test` passed with the full repository suite.
- Runner command timeout cleanup now has regression coverage for descendants spawned during timeout shutdown.

Manual launch validation is still required before marketing or broader user testing:

- Push the completed backlog state to GitHub.
- Confirm the web app production deployment on Vercel.
- Complete production runtime credentials for the GitHub App.
- Run Playwright/manual testing against `rory-hayes/payslip-peeks-and-probes.git` as the test repository.

## Repo Readiness Onboarding

The MVP front door is:

1. Connect GitHub.
2. Select a repository.
3. Describe the product or repository goal.
4. Run a metadata-only repo-readiness scan.
5. Review the readiness report, findings, and recommended next tasks.

Repo scanning is useful before runner installation. It surfaces readiness issues such as missing agent instructions, unclear architecture, weak validation, missing CI, incomplete backlog structure, unsafe path posture, and repo hygiene gaps.

Hosted scan surfaces intentionally keep repo evidence bounded to safe metadata: repository IDs, scan status, report scores, category labels, finding summaries, safe relative paths, task recommendation IDs, timestamps, and audit metadata.

## Cortex Tasks

Cortex Tasks are the MVP's internal AI execution queue. They are not generic tickets; they are approved engineering intents prepared for AI-assisted work.

Each Cortex Task can carry:

- Source finding or external-import metadata.
- Repository metadata.
- Objective and acceptance criteria.
- Risk and execution mode.
- Approval status.
- Suggested validation labels.
- Links to setup PR, runner run, PR artifact, repair, or external task metadata.

Task recommendations can become draft Cortex Tasks after human approval. Approval into a task does not automatically queue a runner job, create a run, or open a PR.

## Setup PRs

The MVP supports setup PRs for deterministic AI-readiness work such as policy files, validation workflow templates, agent instructions, architecture docs, backlog structure, contribution guidance, product spec, and integration notes.

Setup PRs use an elevated GitHub App permission mode that is separate from scan-only permissions. Hosted setup PR previews store filenames, summaries, review instructions, source task links, and `omittedContent: true` markers rather than generated file bodies.

The setup PR writer blocks files outside the approved generated-template allowlist, including source files, real `.env` paths, unapproved root files, and unapproved workflow files.

## Optional Runner Execution

The local runner remains optional until approved local source-code work is needed.

For approved local-runner tasks, the runner:

- Performs dry-run readiness checks before execution.
- Computes local worktree paths runner-side.
- Invokes Codex locally.
- Scans changed paths, warnings, and blockers locally.
- Runs validation locally.
- Commits, pushes, and opens PRs through local git and `gh` credentials.
- Sends only safe run metadata, validation summaries, risk flags, changed paths, and PR artifact metadata back to the hosted app.

The runner hard-blocks dirty repos, protected branches/paths, real `.env` changes, suspected secrets, missing validation config, failed required validation, duplicate assignment, stale locks, and cancelled runs before commit, push, or PR creation.

## Deferred Work

The MVP intentionally does not include:

- Hosted source-code execution.
- Broad company crawling or generic knowledge ingestion.
- Slack or Notion intake.
- Jira import/sync.
- Auto-merge outside the explicit repo-local runner `--auto-merge` flow.
- Multi-agent orchestration.
- Full Stripe billing launch.
- Enterprise SSO.
- SOC2 automation.
- Advanced analytics.
- Mobile app support.

Linear import/sync exists as a bounded optional external path, not the onboarding front door or system of record. Imported external tasks remain drafts until a user manually approves them in Cortex.

## Runtime Setup Status

The production app is deployed and serves the Cortex public landing page. The Vercel production environment has the required Auth0 variables plus `DATABASE_URL` configured, and route smoke now confirms sign-up redirects to Auth0 with a dashboard return target. Full GitHub-connect/setup-PR production E2E remains blocked until the GitHub App runtime variables are configured.

The hosted Supabase Cortex project is reachable, and `pnpm supabase-smoke:check --url <supabase-project-url>` verifies REST/Auth endpoint reachability without printing response bodies, API keys, database credentials, or the project ref. The same command can omit `--url` only when `SUPABASE_URL` is exported in the shell. The latest live explicit-URL smoke returned ready with REST/Auth HTTP 401 key-auth gating in safe text output. The repository is also initialized and locally linked for Supabase CLI workflows through `supabase/config.toml`, with generated `.temp` state ignored and `supabase/README.md` documenting the operator boundary.

Production credential setup is documented in `docs/PRODUCTION_RUNTIME_SETUP.md`. `pnpm release-readiness:check` now runs the combined safe release gate across local runtime env, Vercel production environment variable names, GitHub App runtime identity, deployed route smoke, Supabase link state, Supabase migration history, direct Supabase database connectivity, and Supabase endpoint smoke without printing secret values, Supabase refs, database URLs, API keys, private keys, JWTs, webhook secrets, response bodies, local paths, query output, or raw database client errors. The lower-level commands remain available: `pnpm vercel-production-env:check` safely compares Vercel production environment variable names against the required runtime set without printing values, `pnpm vercel-production-env:apply --dry-run` safely previews missing required variables that can be applied from the current shell, `pnpm production-runtime:check` uses `apps/web/src/runtime/env.ts` to provide a sanitized readiness check for the required Auth0, Supabase database, and GitHub App environment variables in the current shell, `pnpm github-app:check` safely signs a local GitHub App JWT and verifies app identity without printing private keys, JWTs, or webhook secrets, `pnpm production-smoke:check` safely verifies deployed public/protected route reachability and the sign-up Auth0 redirect without printing response bodies, `pnpm supabase-link:check` safely verifies local Supabase link status without printing project refs or paths, `pnpm supabase-migrations:check` safely compares canonical local package migration IDs with linked remote migration history without applying migrations, `pnpm supabase-db:check` safely verifies direct Postgres connectivity using `DATABASE_URL` from the environment through `psql` or the app's Node Postgres client without printing database URLs or passwords, and `pnpm supabase-smoke:check --url <supabase-project-url>` safely verifies Supabase endpoint reachability without implying table grants or direct database access.

Canonical SQL migrations remain owned by `packages/db/migrations` and Drizzle metadata remains under `packages/db/migrations/meta`. Do not transfer migration ownership into `supabase/migrations` unless the project explicitly changes migration strategy.

Local Supabase link is complete and linked remote migration history is readable. Package migration `0022` has now been applied to the linked remote database, `pnpm supabase-migrations:check` reports local and remote migration history through `0022`, and direct database verification passes when `DATABASE_URL` is loaded. Local `supabase migration list --local` requires local Supabase services to be running.

## Known Risks And Limitations

- `RFB-077` and `RFB-081` are complete after token-storage documentation/checks were ported safely into the current tree with a reviewed security-model pointer.
- Billing is a read-only internal MVP placeholder; full Stripe checkout, customer portal, and paid upgrade flows are deferred.
- Production runtime credentials for the GitHub App must be configured before the GitHub-connect/setup-PR production E2E can complete.
- The `rory-hayes/payslip-peeks-and-probes.git` test repository should be used for the post-backlog manual/Playwright validation pass before marketing work begins.

## Release Review Checklist

Before marketing:

1. Confirm the deployed app can sign in, create or select a workspace, connect GitHub, select `rory-hayes/payslip-peeks-and-probes.git`, describe the repo goal, and run a readiness scan.
2. Confirm readiness reports, findings, task recommendations, and Cortex Tasks are understandable without installing a runner.
3. Confirm setup PR preview and draft setup PR creation remain metadata-only.
4. Confirm optional runner execution remains gated behind approval, dry run, validation, local commit/push/PR creation, and human review.
5. Confirm security-boundary warnings and blockers are visible without exposing raw source, diffs, patches, snippets, secrets, `.env` contents, or unredacted command output.
6. Confirm direct Supabase database verification after the remote Postgres password is available.

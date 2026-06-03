# AI Engineering Control Plane

This repository is building an AI Engineering Control Plane: a system where a hosted web coordinator can manage engineering intent while local runners execute source-code work inside customer-controlled repositories.

The MVP trust boundary is strict: the runner executes locally, and the web app coordinates metadata. Raw source code, diffs, patches, code snippets, secrets, private keys, `.env` contents, and unredacted command output must not be sent to the web app.

## Current State

As of May 23, 2026, the repository has completed and verified the project-foundation phase, shared contracts, local runner CLI skeleton, repo policy system, dry-run readiness checks, git worktree and branch manager, the local `@control-plane/codex` adapter package surface, runner-level Codex adapter wiring, the runner-local changed-file scanner, the runner-local `.env` hard-block detector, the runner-local suspected secret detector, the runner-local protected path safety gate, the runner-local warning path classifier, the runner-local change-size gate, the composed change scan result, and the runner-flow safety gate wiring. The Codex package now exposes `CODEX_EXECUTION_STATUSES`, public adapter request/result/status types, `renderTaskPacketPrompt`, `createCodexExecAdapter`, and `createMockCodexAdapter`. The real local adapter invokes `codex exec --cd <worktreePath> --color never -` with direct argv, `shell: false`, `cwd` set to the task worktree, and the rendered prompt passed through stdin rather than process argv. Adapter results carry local execution status, exit code, duration, redacted stdout/stderr summaries, and `redactionApplied`; they do not model raw command output, prompts, source, diffs, patches, snippets, or web-bound code payloads. The mock adapter writes deterministic fixture file changes under the local worktree after rejecting unsafe target paths and real `.env` writes, and returns only synthesized safe summaries. The runner now selects mock or local Codex mode from local config after worktree creation, renders the prompt with the actual worktree path, invokes the adapter locally, and returns only safe Codex result metadata to the runner flow.

The runner CLI now wires `run --repo <path> --task <path> --dry-run [--events-out <path>] [--config <path>]` into the real local readiness flow: it loads config and task packets, rejects event output inside the target repo before output, calls `runDryRun`, emits schema-valid local `dry_run_running` plus `dry_run_passed` or `blocked` events, prints a schema-valid `DryRunResult` JSON line to stdout, exits `0` for `passed`/`warning`, and exits nonzero for `failed`. The branch naming helper now generates deterministic `aicp/` branches from task identity metadata with sanitized visible segments and a short SHA-256 suffix, while avoiding task prose and secret-looking values. The worktree path helper now computes deterministic runner-owned task worktree paths from run identity, rejects traversal and env-like roots, and fails closed when protected or sensitive repo policy would cover the computed path. The worktree creation helper now creates a branch/worktree only after a schema-valid dry run has no blockers, validates run identity plus branch/path safety before mutation, checks final path occupancy, creates only the parent directory before `git worktree add`, and exposes safe local execution metadata without raw command output. The worktree cleanup helper now refuses unsafe roots, outside-root paths, and realpath escapes before running git; removes only existing runner-owned worktrees with `git worktree remove --force`; prunes stale entries with `git worktree prune --expire now`; and leaves branch deletion out of scope. The runner event helper module now builds schema-valid dry-run, `worktree_created`, Codex start/finish, and canonical-state cleanup events; internal non-dry-run runner setup emits `worktree_created`, `codex_running`, and metadata-only Codex finish events after successful worktree creation while still stopping before change scanning, validation, commit, push, or PR creation.

The worktree milestone verification confirmed focused branch/path/create/cleanup coverage, related readiness/event/run coverage, and the root test suite passing; cleanup safety output covered outside-root refusal, symlink escape refusal, and fixture cleanup that preserves task branches. The runner-local changed-file scanner now invokes `git status --porcelain=v1 -z --untracked-files=all`, reports only added/modified/deleted/untracked path arrays and counts, omits unsafe path text while incrementing `omittedPathCount`, and fails closed on Git, malformed, or truncated output without returning command summaries, diffs, patches, source, content, or file contents. The runner-local `.env` hard-block detector now converts changed env-like paths into a schema-valid blocked `RiskFinding` without reading file contents, inspecting diffs, or depending on repo policy; `.env.example` templates remain allowed. The runner-local suspected secret scanner now reads changed file contents only inside the local worktree, skips unsafe paths, missing files, directories, symlinked files, and symlinked path directories, detects private key headers, credential URLs, provider tokens, JWTs, lower/mixed-case secret-like assignments, and context-aware high-entropy tokens, and returns only schema-valid blocked `RiskFinding` objects with redacted category IDs/messages plus sorted paths. The runner-local protected path detector now evaluates changed paths against `RepoPolicy.protectedPaths` through the policy package, returns only schema-valid `protected_path` blockers with changed path metadata, ignores sensitive and warning paths for this focused task, and fails closed with a generic pathless block when policy evaluation cannot be trusted. The runner-local warning path classifier now evaluates changed paths against a warning-only policy made from repo warning paths plus conservative built-in patterns, returns schema-valid warning `RiskFinding` objects for package locks, migrations, infrastructure, auth, and billing paths, normalizes and deduplicates path metadata, and never reads file contents, diffs, patches, or command output. The runner-local change-size gate now counts changed files, omitted paths, tracked-diff shortstat lines, and untracked file additions locally, emits schema-valid large-diff warnings for policy threshold breaches, fails closed when diff stats cannot be trusted, and never serializes raw diffs, patches, source-like keys, command output, or secret text. The composed change scan result aggregates changed paths, omitted path counts, blockers, warnings, and gate status without exposing raw diffs or file contents, and the runner now invokes that scan after Codex implementation before review, validation, commit, push, or PR creation. The safety gate milestone has now been verified with focused changed-file, env, secret, protected-path, warning-path, size, composed scan, and script quality-gate tests passing. The runner event milestone has now been verified with focused runner event tests and an inspected local JSONL sample that preserves unique idempotency keys, follows the expected dry-run/worktree/change-scan sequence, and contains no unsafe metadata keys or source-like/secret values. The GitHub PR helper now opens draft PRs through local `gh` using direct argv and stdin body input, returns schema-valid metadata-only PR artifacts, and blocks raw diff, patch, source-like, command-output, secret, and unsafe path leakage before artifacts leave the runner boundary. The commit/push/PR milestone has now been verified with PR summary and helper hardening that omits or rejects source-like task prose before PR metadata leaves the local boundary. The blocked-path runner E2E tests now prove `.env`, suspected secret, protected path, failed validation, dirty repo, and cancellation-before-commit scenarios stop before commit, push, PR, or unsafe web-bound artifact leakage. Sprint 1 runner proof is now verified in `SPRINT.md` with focused contract, policy, validation, Codex, GitHub, runner E2E, full root validation, and non-exfiltration checks passing. The minimal Next.js web app scaffold is now in place under `apps/web` with App Router, TypeScript, Tailwind, build/typecheck scripts, and a basic operational shell that preserves the local-execution trust boundary. The web app now has a shadcn/Radix UI primitive baseline, an internal UI smoke route, a Clerk auth shell with safe placeholder env documentation, sign-in/sign-up routes, a protected dashboard route, an authenticated app navigation shell, a Drizzle/Postgres foundation with core control-plane schema tables and generated migrations, server-side action/API conventions for workspace-scoped mutations, a durable manual job queue model with workspace/repo-scoped queue helpers that reject raw source, diff, patch, log, snippet, and secret-like packet payloads, and a runner-scoped repo mapping model/API that stores local path metadata without source indexing. Run detail pages now show safe dry-run readiness results, validation results, timeline events, stored PR artifact metadata, and bounded repair request controls including PR link/status/title, branch, repository, changed path metadata, risk flags, repair attempt counts, limit-aware disabled states, and concise repair feedback submission without exposing raw source, diffs, patches, snippets, or unredacted logs. The repair flow now has a server-only repair packet builder that creates schema-valid repair-mode task packets from safe prior-run metadata and sanitized repair feedback without raw code, diffs, patches, snippets, or unredacted logs, and the local runner now supports bounded repair-mode execution against existing task branches with repair worktree safety checks, attempt limits, cancellation before repair, metadata-only repair events, validation, push, and PR artifact refresh. The Dashboard Polish backlog now requires merging/adapting the Cortex UI/UX from `https://github.com/rory-hayes/code-companion.git`, using `src/routes/handover.tsx` as the canonical screen and data handover before MVP validation. `TASK-166` has polished the repositories and runners pages with clearer operational scanning, setup guidance, policy posture counts, validation summaries, runner health, capability details, and safer status copy. `TASK-167` has polished the tasks, runs, approvals, and pull request review surfaces with dense metadata tables, evidence summaries, review-state filters, and evidence-backed approve/reject/repair controls that preserve the local-runner trust boundary. The verified fixture dry run produced schema-valid dry-run output and events without mutating the fixture repository or leaking raw source, diffs, patches, snippets, or unsafe metadata keys. The CLI dry-run path and `mode: "dryRun"` task packets still do not invoke Codex, create worktrees, run validation commands, commit, push, or open PRs. The next approval/repair step is `TASK-149`.

Completed foundation work:

- `TASK-001`: locked the repo to `pnpm` workspaces.
- `TASK-002`: added root command plumbing for build, typecheck, lint, test, and format check.
- `TASK-003`: added a shared TypeScript configuration baseline.
- `TASK-004`: scaffolded the monorepo package layout.
- `TASK-005`: added the formatting, linting, and test baseline.
- `TASK-006`: added safe web and runner environment example stubs.
- `TASK-007`: added this documentation index and current-state summary.
- `TASK-008`: added a git ignore baseline for local secrets, runner state, fixture temp repositories, generated output, and build caches.
- `TASK-009`: added a placeholder GitHub Actions CI workflow for root install, typecheck, lint, and test checks.
- `TASK-010`: verified foundation state with workspace listing, typecheck, lint, test, format check, and tracked secret-file scan passing.

Completed shared contracts work:

- `TASK-011`: created the `@control-plane/shared` package entrypoint, exported `CONTRACT_VERSION = "2026-05-10.v1"`, added package-local test and typecheck setup, and verified entrypoint imports.
- `TASK-012`: added the canonical `RunState` contract with a Zod enum matching `DATA_MODEL.md`, an inferred TypeScript type, terminal-state helper, direct `zod` dependency, and package entrypoint exports.
- `TASK-013`: added strict shared `RiskFinding` and `ValidationCommand` contracts with documented risk severities, risk categories, validation command field rules, inferred TypeScript types, and package entrypoint exports.
- `TASK-014`: added the strict shared `RepoPolicy` contract with contract-version enforcement, dry-run check enums, warning path categories, validation command requirements, positive numeric limits, inferred TypeScript types, and package entrypoint exports.
- `TASK-015`: added the strict shared `TaskPacket` contract with documented mode/source enums, path-only context files, strict nested packet sections, repair-mode rules, `RepoPolicy`/`ValidationCommand` reuse, inferred TypeScript types, and package entrypoint exports.
- `TASK-016`: added the strict shared `RunEvent` contract with documented severities, canonical `RunState` validation, required idempotency keys, a deterministic idempotency-key helper, recursive unsafe metadata key rejection, inferred TypeScript types, and package entrypoint exports.
- `TASK-017`: added the strict shared `ValidationResult` contract with documented result statuses, required redaction metadata, redacted stdout/stderr summary strings, numeric result constraints, inferred TypeScript types, and package entrypoint exports.
- `TASK-018`: added the strict shared `ApprovalDecision` contract with documented human decision values, required actor/run/reason/timestamp audit fields, inferred TypeScript types, and package entrypoint exports.
- `TASK-019`: added the strict shared `RunnerCapabilities` contract with OS metadata, shell, fixed optional tool capabilities, max concurrency, dry-run support, cancellation support, report timestamp validation, inferred TypeScript types, and package entrypoint exports.
- `TASK-020`: added the strict shared `DryRunResult` contract with documented result and check statuses, `DryRunCheck` ids, nested `RunnerCapabilities` and `RiskFinding` validation, recursive unsafe metadata key rejection, inferred TypeScript types, and package entrypoint exports.
- `TASK-021`: added strict shared `RunnerProtocol` contracts for link, heartbeat, polling, claims, run event submission, dry-run result submission, validation result submission, PR artifact submission, cancellation, repair, and close payloads, with claim idempotency-key validation, runId cross-field checks, repair-packet enforcement, source-like/raw-log event metadata rejection, PR artifact safety, inferred TypeScript types, and package entrypoint exports.
- `TASK-022`: added canonical v1 JSON fixtures for valid and invalid shared contracts, including RunnerProtocol payload variants, expected invalid issue-path assertions, and fixture hygiene checks for raw secrets, diffs, patches, and code snippets.
- `TASK-023`: added a v1 contract compatibility test harness that parses every canonical valid fixture through public `@control-plane/shared` schema exports, verifies manifest coverage, and checks declared `contractVersion` fields.
- `TASK-024`: added public `@control-plane/shared` entrypoint smoke coverage for every completed shared contract runtime export and public contract type import.
- `TASK-025`: verified the shared contracts milestone with the shared package test suite, root typecheck, fixture parse counts, fixture hygiene, compatibility manifest coverage, and contract-version checks.

Completed local runner CLI skeleton work:

- `TASK-026`: created the source-backed `@control-plane/runner` package entrypoint with exports, types, bin wiring, package-local test/typecheck scripts, a parse-only `run` command parser, help output, safe argument errors, and tests for the CLI surface.
- `TASK-027`: added a standalone task packet loader that reads local JSON, validates it with `TaskPacketSchema` from `@control-plane/shared`, returns a typed `TaskPacket`, exports safe loader errors, and avoids echoing packet bodies or embedded source-like context.
- `TASK-028`: added a local-only runner config loader with stable defaults, optional JSON config loading, partial config merging, mock mode flags, safe manual validation, credential-like key rejection, generic unknown-key error paths, and public runner exports.
- `TASK-029`: added local repo path validation with path stat checks, directory rejection before Git runs, injectable `git rev-parse --is-inside-work-tree` verification, and safe structured errors that do not echo Git output.
- `TASK-030`: added a runner-local direct-argv command wrapper with typed command metadata, cwd, exit code, duration, redacted stdout/stderr summaries, safe missing-executable handling, and optional throwing through `CommandExecutionError`.
- `TASK-031`: added a runner-local `RunnerError` API with stable categories, exit-code mappings, default user-safe messages, safe summary conversion, recursive unsafe metadata stripping, and secret-value redaction.
- `TASK-032`: added a runner-local event output writer that validates `RunEvent` objects through the shared schema before appending JSONL, preserves idempotency keys, wraps write failures safely, and rejects unsafe metadata keys through the shared contract.
- `TASK-033`: wired the runner skeleton flow so the CLI loads config and task packets, validates the repo path, emits metadata-only local dry-run events, maps safe errors, supports `--config <path>`, and avoids target repo mutation, including symlinked repo paths.

Completed repo policy system work:

- `TASK-034`: defined the repo-local policy file convention as exactly `.aicp/policy.json`, added `@control-plane/policies` package-local test/typecheck plumbing, exported path lookup helpers, and made missing or non-file policy paths fail with structured safe errors instead of falling back to permissive defaults.
- `TASK-035`: added a repo policy parser that reads exactly `.aicp/policy.json`, validates JSON through `RepoPolicySchema` from `@control-plane/shared`, returns typed `RepoPolicy` data, and reports safe structured parse errors without echoing policy contents, secret-looking unknown keys, or values.
- `TASK-036`: added reusable policy fixtures for valid, missing-validation, invalid-JSON, and sensitive-path policy cases, plus parser fixture coverage and fixture hygiene checks.
- `TASK-037`: added a dependency-free protected path evaluator that normalizes repo-relative changed paths, rejects absolute and repo-escaping paths, blocks protected and sensitive path matches, treats real `.env` paths as sensitive, preserves `.env.example` as implicitly safe, rejects unsupported advanced glob syntax, and returns deterministic warning category matches.
- `TASK-038`: added a pure risk finding builder that converts path policy evaluations into shared `RiskFinding` blockers and warnings with stable IDs, deterministic ordering, deduplicated normalized paths, and no pattern/content/diff/log metadata.
- `TASK-039`: verified the policy system milestone with parser, fixture, protected path evaluator, risk finding builder, and missing-policy hard-block coverage passing.

Completed dry run readiness checks:

- `TASK-040`: added runner-local capability detection for OS, shell, git, gh, codex, node, npm, pnpm, yarn, python, max concurrency, dry-run support, and cancellation support, with shared schema validation and safe handling for missing tools and token-like command output.
- `TASK-041`: added runner-local git clean-state detection using `git status --porcelain=v1 -z --untracked-files=all`, with schema-validated metadata counts, safe repo-relative paths only, dirty-repo blockers, and fail-closed handling for Git failures or malformed/truncated output.
- `TASK-042`: added runner-local protected branch detection using `git symbolic-ref --quiet --short HEAD`, with schema-validated protected-branch blockers, safe branch metadata, supported wildcard matching, and fail-closed handling for detached, unknown, malformed, truncated, redacted, or unsupported policy states.
- `TASK-043`: added runner-local validation config readiness checking that blocks missing, empty, optional-only, or blank validation command configurations without running validation or exposing command text.
- `TASK-044`: added runner-local required tool readiness checking that blocks missing required `git`, mode-required `codex`, PR-required `gh`, and required validation-command tools while warning on unavailable optional tools without exposing command text or tool paths.
- `TASK-045`: added runner-local worktree readiness checking that validates target branch format and local branch availability, requires an absolute worktree target before lstat-only occupancy inspection, verifies repo localPath mapping by realpath, and avoids exposing source-like text, command output, secrets, diffs, patches, or absolute local paths.
- `TASK-046`: added runner-local protected/sensitive path policy readiness checking that blocks missing protected path configuration, warns on missing explicit sensitive path patterns, proves implicit `.env` and `.env.*` hard-block behavior with empty explicit path arrays, allows `.env.example`, and fails closed on unsupported protected/sensitive glob syntax without exposing policy pattern values.
- `TASK-047`: added the runner-local `runDryRun` aggregator with all 11 canonical checks represented in shared-schema order, blocker/warning status derivation, dependency-aware skipped checks, runner capabilities inclusion, and schema-level unsafe metadata rejection.
- `TASK-048`: wired CLI dry-run mode to `runDryRun`, including safe terminal events, stdout `DryRunResult` output, predictable exit codes, and manual fixture proof that the target repo stays unmodified.
- `TASK-049`: verified the dry-run milestone with focused runner dry-run tests, root tests, hygiene checks, and a throwaway committed fixture CLI dry run proving schema-valid metadata-only output, no blockers, no failed checks, no fixture mutation, and no worktree creation.

Completed git worktree and branch manager work:

- `TASK-050`: added a pure runner branch naming helper that emits deterministic `aicp/` branch names from task identity fields, sanitizes visible task/run segments, falls back for secret-looking identifiers, appends a 12-character SHA-256 suffix, exports the helper through `@control-plane/runner`, and reuses the shared branch safety check in worktree readiness.
- `TASK-051`: added a pure runner worktree path helper that computes deterministic run-id-based task worktree paths under the configured runner root, rejects traversal and env-like roots, fails closed on policy evaluation errors, blocks protected or sensitive policy coverage, and exports the helper through `@control-plane/runner`.
- `TASK-052`: added a runner-local worktree creation helper that gates on schema-valid unblocked dry runs, refuses mismatched run ids and unsafe branch/path inputs before mutation, checks path occupancy before git, creates only the parent directory, invokes `git worktree add -b <targetBranch> <worktreePath> <defaultBranch>` through direct argv, and returns safe local metadata.
- `TASK-053`: added a runner-local worktree cleanup helper that proves a target is inside the configured runner worktree root before mutation, removes existing runner-owned worktrees, prunes stale git worktree entries, skips missing paths safely, and does not delete task branches.
- `TASK-054`: added runner event helpers for dry-run, `worktree_created`, and canonical-state cleanup events, and wired internal non-dry-run setup to emit schema-valid worktree creation events with branch/path-only metadata after successful worktree creation.
- `TASK-055`: verified the worktree milestone with focused branch/path/create/cleanup tests, related readiness/event/run tests, root tests, and cleanup safety proof.

Completed Codex exec adapter work:

- `TASK-056`: created the minimal `@control-plane/codex` package entrypoint with package exports, test/typecheck plumbing, public adapter request/result/status types, and entrypoint tests proving the runtime export surface plus compile-time adapter injection.
- `TASK-057`: added `renderTaskPacketPrompt`, a pure prompt renderer that includes task objective, acceptance criteria, source metadata, repo/path references, context notes, policy summary, validation commands, and repair context without reading referenced files or embedding raw source contents.
- `TASK-058`: implemented `createCodexExecAdapter` with direct local `codex exec` invocation, worktree cwd handling, stdin prompt delivery, async stdin error handling, timeout kill handling, exit status mapping, bounded redacted summaries, prompt scrubbing, broad source-like output suppression including non-JS snippets, dotenv/access-token/JWT redaction, package tests passing, package typecheck passing, root lint passing, and root format check passing.
- `TASK-059`: implemented `createMockCodexAdapter` with deterministic default fixture file output, explicit safe file-change instructions, unsafe path and real `.env` rejection, secret-looking `.env.example` template rejection, symlink escape rejection, synthesized summaries, package tests passing, package typecheck passing, root lint passing, and root format check passing.
- `TASK-060`: wired runner-level Codex adapter selection and invocation after worktree creation, with metadata-only Codex start/finish events and no prompt, raw output, diff, patch, snippet, or file-content event leakage.

Completed change scanner and safety gates work:

- `TASK-061`: added the runner-local git changed-file scanner with direct argv `git status` invocation, NUL-delimited porcelain parsing, deterministic path arrays and counts for added, modified, deleted, and untracked files, unsafe path omission with `omittedPathCount`, fail-closed scanner errors, and public runner entrypoint exports.
- `TASK-062`: added the runner-local `.env` hard-block detector with normalized path matching, `.env.example` allowance, schema-valid blocked `RiskFinding` output, public runner entrypoint exports, and non-leakage tests for diff, patch, source, code, content, command output, and secret text.
- `TASK-063`: added the runner-local suspected secret detector with safe local file reads, symlinked path segment skipping, fixed-category blocked `RiskFinding` output, lower/mixed-case assignment detection, context-aware high-entropy detection, placeholder allowance, public runner entrypoint exports, and non-leakage tests.
- `TASK-064`: added the runner-local protected path safety gate with protected-only policy evaluation, schema-valid blocked `RiskFinding` output, fail-closed unsupported glob handling, public runner entrypoint exports, and non-leakage tests.
- `TASK-065`: added the runner-local warning path classifier with policy plus built-in warning patterns, schema-valid warning-only `RiskFinding` output, path normalization and dedupe, public runner entrypoint exports, and non-leakage tests.
- `TASK-066`: added the runner-local change-size gate with changed-file, omitted-path, tracked-diff, and untracked-file thresholds, schema-valid large-diff warnings, fail-closed blocker behavior, public runner entrypoint exports, and non-leakage tests.
- `TASK-067`: composed the runner-local change scan result from changed-file metadata, `.env` blockers, suspected-secret blockers, protected-path blockers, warning-path findings, and change-size findings without raw diffs, patches, snippets, command output, or file contents.
- `TASK-068`: wired the composed change scan into the runner flow after Codex implementation and before review, validation, commit, push, and PR creation.

Current next implementation task:

- `TASK-161`: Ready for runner selection.
- `TASK-174`: Blocked pending a scoped follow-up for capability-value filtering; the existing task is test-only and excludes new endpoint behavior.

Latest completed task:

- `TASK-159`: Implemented bounded Linear issue candidate sync with metadata-only persistence, mocked API coverage, database schema/migration support, and web/db exports. The stale-base merge conflict was repaired by rebasing onto current `main` and preserving the existing GitHub/PR schema snapshot.
- `TASK-167`: Polished tasks, runs, approvals, and pull request review pages with dense operational metadata, evidence summaries, review-state filters, and evidence-backed approve/reject/repair controls without exposing source, diffs, patches, snippets, or raw logs.

Runner status:

- The local backlog runner stopped on a stale-base merge conflict for `TASK-159`; that task has now been manually repaired, validated, merged, and pushed. `TASK-169` and `TASK-178` are marked blocked with preserved worktrees so the next runner restart can continue from `TASK-160` instead of recycling known blockers.

Known stability notes:

- Concurrent merge-queue conflicts in shared web server action files, web test config, database exports, generated migration metadata, or task-local package scripts can still require manual repair. Do not weaken validation gates; refresh from `main`, preserve partial work artifacts, rerun full validation, and only then merge/restart the runner.

`TASK-144` added run-detail approve/reject controls for runs awaiting approval. `TASK-167` now builds on those actions with evidence-backed review surfaces for tasks, runs, approvals, and PR metadata; the UI keeps decisions gated on validation evidence, PR metadata, changed path metadata, and policy/risk evidence, and deliberately does not expose merge controls or raw source artifacts.

The local Codex backlog runner has also been implemented under `scripts/codex-runner`. It is repo-specific, reads `BACKLOG.md`, includes `AGENTS.md` in prompts, creates isolated git worktrees, runs Codex through plan, approve, implement, review, validate, fix, commit, push, PR, and optional auto-merge phases, and writes ignored run artifacts under `runs/<run-id>/`.

## Current Functionality

The repository currently supports:

- Local backlog task selection from `BACKLOG.md`.
- Agent-instruction enforcement through `AGENTS.md`.
- Plan-only runner mode by default.
- Explicit implementation approval through `--approve-plan`.
- One-task or multi-task execution through `--limit=1`, `--limit=5`, and `--all`.
- Optional verified auto-merge through `--auto-merge`.
- Optional explicit parallel worker slots through `--concurrency=N` when paired with `--approve-plan` and `--auto-merge`; independent Ready tasks can implement in separate worktrees while a serial merge queue refreshes each branch from latest `origin/main`, applies `BACKLOG.md` and `README.md` bookkeeping on the refreshed branch, reruns full validation, and merges one at a time.
- A read-only local dashboard through `pnpm codex-runner-dashboard` for current runner health, recent runs, ready tasks, blockers, active worktrees, task commits, approximate code-line additions, and rough time-saved estimates.
- File-aware concurrent scheduling that reads `Files Likely Touched:` from `BACKLOG.md`, normalizes markdown-wrapped path entries, and avoids launching Ready tasks together when they are expected to edit the same non-bookkeeping file.
- Bookkeeping-only rebase repair for concurrent merge queues: `BACKLOG.md` and `README.md` conflicts keep latest `main`, then the merge queue reapplies current task status before validation; source-code conflicts still block.
- Isolated task branches named `codex/TASK-###-slug`.
- Isolated git worktrees per task.
- Dependency preparation inside task worktrees before implementation and validation.
- A local runner lock that prevents two backlog runs from mutating the same repo at once.
- Bounded Codex phase retries through `--codex-attempts=`.
- Configurable Codex phase timeout budgets through `--codex-timeout-ms=`.
- Structured failure artifacts for timed-out or failed Codex phases.
- Draft PR creation through the local `gh` CLI.
- Existing task PR reuse so retries do not create duplicate PRs.
- Full local verification before auto-merge.
- Automatic task worktree and branch cleanup after successful auto-merge.
- Quality gates for dirty repos, protected files, real `.env*` edits, suspected secrets, missing validation, raw diff leakage, and missing tests for non-doc code.
- Safe `.env.example` template updates for documenting required configuration without committing local secrets.
- A repository `.gitignore` baseline that keeps local env files, runner state, run artifacts, fixture temp repositories, generated output, and common build caches out of git while preserving tracked docs and `.env.example` templates.
- Active root quality checks for Prettier formatting, ESLint flat-config linting, Vitest tests, and TypeScript typechecking.
- A planned Cortex UI/UX handover in the Dashboard Polish milestone, using `rory-hayes/code-companion` and `src/routes/handover.tsx` so the MVP includes the approved interface direction as well as the backend/control-plane loop.
- A minimal Next.js App Router web shell in `apps/web` with TypeScript, Tailwind, a verified production build, and operational control-plane layout placeholders for the upcoming dashboard work.
- A shared contract package shell at `packages/shared` with a tested `@control-plane/shared` entrypoint and canonical contract version export.
- A canonical shared `RunState` schema with documented cancellation states, terminal-state detection, and tests for accepted and rejected state values.
- Shared `RiskFinding` and `ValidationCommand` schemas with documented blocker/warning categories, safe path-only risk metadata, validation command timeout rules, and entrypoint exports.
- A shared `RepoPolicy` schema with strict protected branch/path, sensitive path, warning path, validation command, numeric limit, untracked-file, and dry-run check validation.
- A shared `TaskPacket` schema with manual, dry-run, execute, and repair packet validation, path-only context references, strict rejection of embedded source-like fields, and repair attempt bounds.
- A shared `RunEvent` schema with required idempotency keys, documented severities, canonical run-state validation, deterministic event idempotency-key generation, and recursive metadata rejection for raw code payload keys such as `diff`, `patch`, `source`, and `code`.
- A shared `ValidationResult` schema with passed, failed, skipped, and cancelled statuses, required `redactionApplied`, redacted stdout/stderr summary strings, nullable non-negative exit codes, non-negative durations, and strict top-level field validation.
- A shared `ApprovalDecision` schema with approve, reject, request repair, rerun validation, cancel run, and close run decisions, required non-empty audit fields, and strict top-level field validation.
- A shared `RunnerCapabilities` schema with strict OS metadata, shell, fixed optional tool capability keys for git, gh, codex, node, npm, pnpm, yarn, and python, positive max concurrency, dry-run and cancellation support flags, and report timestamp validation.
- A shared `DryRunResult` schema with passed, warning, and failed result statuses, passed, failed, warning, and skipped check statuses, `DryRunCheck` id reuse, nested capability and risk-finding validation, and metadata-only check payloads that reject raw source, diff, patch, content, and snippet keys recursively.
- A shared `RunnerProtocol` schema set with versioned link, heartbeat, job polling, claim, event submission, dry-run result, validation result, PR artifact, cancellation, repair, and close payload validation, including canonical claim idempotency keys, source-like/raw-log event metadata rejection, and metadata-only PR artifacts.
- Versioned shared contract fixtures under `packages/shared/fixtures/v1` with valid examples for each shared contract and RunnerProtocol payload variant, invalid examples for missing idempotency, embedded source-like payloads, invalid contract versions, and representative contract failures, plus fixture hygiene checks.
- A shared contract compatibility harness that verifies the current schemas continue to parse every canonical valid v1 fixture through the public package entrypoint and that fixture manifests stay complete.
- Public shared package entrypoint smoke coverage that verifies `@control-plane/shared` exposes every completed shared contract schema, constant, helper, and inferred type.
- Verified shared contracts milestone evidence for runner implementation: 27 valid v1 fixtures parse, 14 invalid v1 fixtures reject at expected issue paths, fixture hygiene checks pass, compatibility coverage is complete, and declared contract versions match `CONTRACT_VERSION`.
- A source-backed `@control-plane/runner` package entrypoint with `control-plane-runner` bin wiring, package-local tests/typecheck, global help, `run --help`, safe missing/unknown argument errors, and skeleton handling for `run --repo <path> --task <path> --dry-run [--events-out <path>] [--config <path>]`.
- A source-backed `@control-plane/codex` package entrypoint with a minimal execution-status constant, public adapter request/result/status types, a local-only task-packet prompt renderer, a real local `codex exec` adapter, and a deterministic mocked Codex adapter for Sprint 1 tests; the runner now selects and invokes these adapters after worktree creation.
- A standalone runner task packet loader exported from `@control-plane/runner` that reads a local JSON file, validates it through the shared `TaskPacketSchema`, returns a typed packet, and reports safe `read_failed`, `invalid_json`, or `invalid_task_packet` errors without printing raw JSON or embedded context.
- A local-only runner config loader exported from `@control-plane/runner` that returns stable defaults, loads optional JSON config paths, merges partial mock mode settings, and reports safe `read_failed`, `invalid_json`, or `invalid_config` errors without echoing config contents, secret-like values, or secret-looking unknown key names.
- A local repo path validator exported from `@control-plane/runner` that rejects missing paths and file paths before Git runs, verifies Git working-tree status through an injectable direct-argv Git wrapper, and keeps Git stdout/stderr out of structured error text.
- A runner command execution wrapper exported from `@control-plane/runner` that uses direct argv spawning with `shell: false`, returns typed redacted summaries without raw stdout/stderr fields, reports nonzero exits without throwing by default, and supports safe `CommandExecutionError` throwing when configured.
- A runner-local capability detector exported from `@control-plane/runner` that validates `RunnerCapabilities` payloads through the shared schema, reports fixed tool capability keys, parses short safe version tokens, treats missing tools as unavailable, omits failed paths, defaults dry-run support to true, and defaults cancellation support to false until cooperative cancellation is wired.
- A runner-local git clean-state check exported from `@control-plane/runner` that invokes `git status` through direct argv, blocks staged, unstaged, and untracked changes with a shared `dirty_repo` risk finding, returns counts and safe repo-relative paths only, and fails closed without exposing command output when Git status cannot be trusted.
- A runner-local protected branch check exported from `@control-plane/runner` that invokes `git symbolic-ref` through direct argv, blocks protected branches with a shared `protected_branch` risk finding, supports exact and supported wildcard policy matches, and fails closed without exposing command output when branch state cannot be trusted.
- A runner-local validation config readiness check exported from `@control-plane/runner` that blocks execution when policy validation commands are missing, empty, optional-only, or blank while keeping command strings out of dry-run metadata.
- A runner-local required tool readiness check exported from `@control-plane/runner` that evaluates sanitized `RunnerCapabilities`, blocks missing required tools, warns for unavailable optional tools, and keeps command strings, versions, paths, raw outputs, diffs, patches, source, and snippets out of dry-run metadata.
- A runner-local worktree readiness check exported from `@control-plane/runner` that validates target branch names with safe prefiltering plus `git check-ref-format`, blocks existing local branches via `git show-ref`, requires an absolute worktree target before checking occupancy with `lstat`, and keeps absolute local paths and command output out of dry-run metadata.
- A runner-local branch naming helper exported from `@control-plane/runner` that generates deterministic `aicp/` branch names from contract version, repository id, task id, and run id; normalizes unsafe visible characters; avoids secret-looking values; and keeps branch names Git-safe before later worktree creation.
- A runner-local worktree path helper exported from `@control-plane/runner` that derives deterministic run-id-based task worktree paths under the configured runner worktree root, rejects traversal and env-like root paths, avoids secret-looking visible directory names, and blocks protected or sensitive policy coverage before later worktree creation.
- A runner-local worktree creation helper exported from `@control-plane/runner` that creates a branch/worktree only after an unblocked schema-valid dry run for the same run id, refuses unsafe branch names or non-absolute worktree paths before mutation, checks the final path with `lstat`, creates only the parent directory, invokes local git through direct argv, and keeps raw command output out of errors and metadata.
- A runner-local worktree cleanup helper exported from `@control-plane/runner` that refuses relative, empty, root-equal, outside-root, and realpath-escaping cleanup targets before git runs; removes existing runner-owned worktrees with `git worktree remove --force`; prunes stale entries with `git worktree prune --expire now`; and leaves branch deletion out of scope.
- Runner-local event helpers that preserve existing dry-run event metadata, build `worktree_created` and Codex start/finish events with deterministic idempotency keys, and limit worktree/Codex event metadata to branch/path or adapter status fields only.
- A runner-local protected/sensitive path policy readiness check exported from `@control-plane/runner` that verifies protected path configuration, warns on missing explicit sensitive path patterns, independently proves implicit real `.env` blocking while allowing `.env.example`, and keeps policy patterns, raw output, diffs, patches, source, and snippets out of dry-run metadata.
- A runner-local dry-run result aggregator exported from `@control-plane/runner` that validates repo path and Git readiness, parses `.aicp/policy.json`, detects capabilities, runs or represents every documented dry-run check, fills skipped checks when prerequisites fail, derives `passed`, `warning`, or `failed`, and validates the final `DryRunResult` through the shared schema without task prose, raw command output, diffs, patches, or file contents.
- A runner-local Codex helper exported from `@control-plane/runner` that selects mock versus local adapter mode from config, renders task-packet prompts with the actual worktree path, invokes Codex locally, and returns only adapter mode, execution status, exit code, duration, and redaction status to the runner flow.
- A runner-local changed-file scanner exported from `@control-plane/runner` that invokes Git through direct argv, parses NUL-delimited porcelain status output, returns only sorted changed path arrays and counts, omits unsafe path text, and throws safe scanner errors without command summaries or file contents.
- A runner-local `.env` hard-block detector exported from `@control-plane/runner` that blocks `.env`, `.env.*`, `local.env`, and `*.local.env` path changes while allowing `.env.example` templates and returning only path metadata in a shared-schema `RiskFinding`.
- A runner-local suspected secret scanner exported from `@control-plane/runner` that reads changed files inside the local worktree only, skips unsafe paths and symlinked path segments, detects common secret patterns plus lower/mixed-case assignments and context-aware high-entropy tokens, and returns only shared-schema blocked `RiskFinding` objects with category IDs/messages and sorted paths.
- A runner-local protected path detector exported from `@control-plane/runner` that classifies changed paths against `RepoPolicy.protectedPaths`, returns only shared-schema blocked `protected_path` findings with changed path metadata, ignores warning and sensitive paths for this detector, and fails closed without leaking policy patterns.
- A runner-local warning path classifier exported from `@control-plane/runner` that classifies changed paths against repo warning paths plus conservative built-in patterns, returns only shared-schema warning findings for package locks, migrations, infrastructure, auth, and billing paths, and does not read file contents, diffs, patches, command output, or policy pattern values into serialized output.
- A structured runner error API exported from `@control-plane/runner` that maps local runner failure categories to stable exit codes and user-safe messages, strips unsafe metadata keys recursively, redacts secret-looking metadata strings, and summarizes unknown errors as generic internal failures without raw messages or stacks.
- A runner-local event writer exported from `@control-plane/runner` that validates `RunEvent` payloads before any filesystem write, appends one JSON object per line, preserves idempotency keys, and reports invalid events or write failures without echoing event payload text.
- A runner CLI dry-run flow exported from `@control-plane/runner` that loads local config and task packets, rejects event output paths inside the target repo before output, runs the real readiness aggregator, emits metadata-only `dry_run_running`, `dry_run_passed`, or `blocked` events, prints the schema-valid `DryRunResult` to stdout, and maps safe CLI exit codes without Codex, worktree, validation, commit, push, or PR behavior.
- A source-backed `@control-plane/policies` package entrypoint that defines the repo policy path convention as `.aicp/policy.json`, resolves that file under a supplied repo root, parses and validates policies through the shared `RepoPolicySchema`, and returns structured safe failures for missing, non-file, unreadable, invalid JSON, or schema-invalid policies.
- Reusable policy fixtures for parser and future runner tests, covering a valid policy, a missing-validation schema failure, malformed JSON, and sensitive/protected path examples without raw source, diffs, patches, or secrets.
- A protected path evaluator exported from `@control-plane/policies` that classifies normalized changed paths as blocked, warning, or safe against protected paths, sensitive paths, warning path categories, and implicit real `.env` sensitivity, while failing closed on unsupported advanced glob syntax.
- A risk finding builder exported from `@control-plane/policies` that maps path-policy matches to shared `RiskFinding` objects for protected paths, sensitive paths, package locks, migrations, infrastructure, auth, and billing using normalized path-only metadata.
- Verified policy system milestone evidence for dry-run integration: parser fixtures and safe failures pass, missing `.aicp/policy.json` remains a hard blocker with no permissive fallback, protected path evaluation covers normalized paths and fail-closed glob handling, and risk findings contain deterministic path-only metadata.
- A placeholder GitHub Actions CI workflow that installs dependencies with pnpm and runs root typecheck, lint, and test checks without deployment, Codex execution, `gh`, push commands, or secrets.
- Safe run artifacts that avoid raw diffs, patches, source blobs, and secrets.
- Review verdict parsing that trusts explicit first-line `PASS` or `BLOCKED` decisions before scanning explanatory text.
- A README freshness gate: backlog-moving pushes must update `README.md` so GitHub `main` reflects the current status after every push.
- Unit coverage for backlog parsing, agent policy, quality gates, validation, git helpers, and runner orchestration.

## Recent Runner Test Result

A multi-task auto-merge test successfully completed and merged:

- `TASK-002`: root script surface.
- `TASK-003`: TypeScript config baseline.
- `TASK-004`: monorepo directory scaffold.

`TASK-005` previously stopped safely during implementation because the nested Codex process hit its timeout before review, validation, PR creation, or merge. That was the correct safety outcome: the runner did not mark the task complete and did not merge unreviewed work.

`TASK-005` has now been completed in an isolated task worktree with passing local validation.

A longer auto-merge run then correctly merged `TASK-005` and paused on `TASK-006` after exposing two runner policy gaps: `.env.example` templates were being blocked as if they were real secret-bearing env files, and prose-only validation guidance was being treated as a shell command. The runner now allows `.env.example` templates, continues to block real `.env*` files, and only executes explicit backticked validation commands.

`TASK-006` has now been completed with safe `.env.example` stubs for `apps/web` and `apps/runner`.

`TASK-008` has now been completed with a git ignore baseline for local secrets, runner state, fixture-generated repositories, and build caches.

`TASK-009` has now been completed with a placeholder GitHub Actions CI workflow for root install, typecheck, lint, and test checks.

`TASK-010` has now verified the foundation state: workspace listing, typecheck, lint, tests, format check, and tracked secret-file scan all pass.

`TASK-011` has now created the shared contract package shell with a tested package entrypoint and canonical contract version export.

`TASK-012` has now added the canonical RunState schema, terminal-state helper, package entrypoint exports, and shared contract tests.

`TASK-013` has now added the RiskFinding and ValidationCommand schemas, package entrypoint exports, and shared contract tests.

`TASK-014` has now added the RepoPolicy schema, dry-run check constants, warning path categories, package entrypoint exports, and shared contract tests.

`TASK-015` has now added the TaskPacket schema, mode/source constants, strict nested packet validation, repair-mode rules, package entrypoint exports, and shared contract tests.

`TASK-016` has now added the RunEvent schema, severity constants, idempotency-key helper, recursive unsafe metadata key rejection, package entrypoint exports, and shared contract tests.

`TASK-017` has now added the ValidationResult schema, result status constants, required redaction flag, redacted summary fields, package entrypoint exports, and shared contract tests.

`TASK-018` has now added the ApprovalDecision schema, decision value constants, required human audit fields, package entrypoint exports, and shared contract tests.

`TASK-019` has now added the RunnerCapabilities schema, strict nested OS/tool validation, fixed optional tool keys, package entrypoint exports, and shared contract tests.

`TASK-020` has now added the DryRunResult schema, dry-run check result schema, metadata safety guard, package entrypoint exports, and shared contract tests.

`TASK-021` has now added the RunnerProtocol schema set, protocol constants, deterministic claim idempotency-key helper, source-like/raw-log event metadata rejection, package entrypoint exports, and shared contract tests.

`TASK-022` has now added canonical v1 JSON fixtures for shared contracts and RunnerProtocol payload variants, plus fixture validation and hygiene tests.

`TASK-024` has now added public shared package entrypoint coverage for all completed shared contracts.

`TASK-025` has now verified the shared contracts milestone.

`TASK-026` has now created the runner package entrypoint and parse-only CLI surface.

`TASK-027` has now added the standalone task packet loader with safe error handling and runner package validation passing.

`TASK-028` has now added the local-only runner config loader with safe error handling, credential-like key rejection, package tests passing, and runner typecheck passing.

`TASK-029` has now added local repo path validation with safe structured errors, injectable Git verification, runner package tests passing, and runner typecheck passing.

`TASK-030` has now added the runner command execution wrapper with direct argv spawning, redacted stdout/stderr summaries, safe missing-executable handling, runner package tests passing, and runner typecheck passing.

`TASK-031` has now added the structured runner error type with stable category definitions, safe metadata handling, user-safe summaries, runner package tests passing, and runner typecheck passing.

`TASK-032` has now added the local event output writer with schema validation before filesystem writes, JSONL append behavior, safe writer errors, runner package tests passing, and runner typecheck passing.

`TASK-033` has now wired the runner skeleton flow with config/task loading, repo path validation, metadata-only local run events, safe error mapping, `--config <path>` CLI support, symlink-safe event output containment, runner package tests passing, and runner typecheck passing.

`TASK-035` has now implemented the repo policy parser for `.aicp/policy.json`, added safe parser errors for missing, non-file, unreadable, invalid JSON, and schema-invalid policies, covered secret-leak regressions, and verified policies package tests and typecheck passing.

`TASK-036` has now added reusable policy fixtures for valid, missing-validation, invalid-JSON, and sensitive-path policy cases, updated parser tests to consume those fixtures, added fixture hygiene coverage, and verified policies package tests and typecheck passing.

`TASK-037` has now implemented the protected path evaluator with exact, `*`, and `**` path matching, implicit real `.env` sensitivity, `.env.example` implicit-safety behavior, fail-closed unsupported glob handling, policy package tests passing, and policy package typecheck passing.

`TASK-038` has now implemented the risk finding builder with stable `risk:<category>` IDs, deterministic blocker/warning ordering, normalized path deduplication, path-only metadata, policy package tests passing, and policy package typecheck passing.

`TASK-039` has now verified the policy system milestone with `pnpm --filter @*/policies test` passing, covering parser fixtures, missing-policy hard blocking, path classification, and path-only risk finding output.

`TASK-040` has now added the runner capability detection module with `pnpm --filter @control-plane/runner test`, runner typecheck, root format check, and root lint passing.

`TASK-041` has now added the runner-local git clean-state check with `pnpm --filter @control-plane/runner test`, runner typecheck, root format check, and root lint passing.

`TASK-042` has now added the runner-local protected branch check with `pnpm --filter @control-plane/runner test`, runner typecheck, root format check, and root lint passing.

`TASK-043` has now added the runner-local validation config readiness check with `pnpm --filter @control-plane/runner test`, runner typecheck, root format check, and root lint passing.

`TASK-044` has now added the runner-local required tool readiness check with `pnpm --filter @control-plane/runner test`, runner typecheck, root format check, and root lint passing.

`TASK-045` has now added the runner-local worktree readiness check with `pnpm --filter @control-plane/runner test`, runner typecheck, root format check, and root lint passing.

`TASK-046` has now added the runner-local protected/sensitive path policy readiness check with focused runner tests, full runner tests, runner typecheck, root lint, and root format check passing.

`TASK-047` has now added the runner-local dry-run result aggregator with focused runner tests, full runner tests, runner typecheck, root format check, and root lint passing.

`TASK-048` has now wired CLI dry-run mode to the real readiness aggregator with focused red/green runner tests, full runner tests, runner typecheck, root format check, root lint, and a direct local fixture CLI dry run passing.

`TASK-049` has now verified the dry-run milestone with focused dry-run tests, root tests, typecheck, lint, format check, and a throwaway fixture CLI dry run passing. The fixture proof confirmed no blockers, no failed checks, schema-valid dry-run events, no raw source/diff/patch/snippet leakage, unchanged git status, unchanged HEAD, unchanged branch list, unchanged committed-file checksums, and no worktree path creation.

`TASK-050` has now added the runner branch naming helper with focused branch-name tests, full runner tests, runner typecheck, root lint, and root format check passing.

`TASK-051` has now added the runner worktree path helper with focused worktree-path tests, root typecheck, root lint, root format check, and root test suite passing.

`TASK-052` has now added the runner worktree creation helper with focused create-worktree tests, full runner tests, runner typecheck, root lint, and root format check passing.

`TASK-053` has now added the runner worktree cleanup helper with focused cleanup tests, a real fixture cleanup proof, full runner tests, runner typecheck, root lint, and root format check passing.

`TASK-054` has now added runner worktree event integration with focused event-helper tests, runner-flow tests, full runner tests, root typecheck, root lint, and root format check passing.

`TASK-055` has now verified the worktree milestone with focused branch/worktree tests, related readiness/event/run tests, and the root test suite passing. Cleanup safety output confirmed outside-root refusal before git, symlink escape refusal before git, and fixture cleanup that preserves task branches.

`TASK-056` has now created the minimal `@control-plane/codex` package entrypoint with `CODEX_EXECUTION_STATUSES`, public adapter request/result/status types, package-local test/typecheck scripts, and entrypoint tests.

`TASK-057` has now added the local-only task-packet prompt renderer with focused tests proving execution context rendering, validation command rendering, repair-only metadata rendering, and path-reference-only behavior for context files.

`TASK-058` has now implemented the local `codex exec` adapter with direct argv command construction, worktree cwd handling, prompt-over-stdin execution, async stdin error handling, timeout kill handling, exit status mapping, missing executable handling, redacted stdout/stderr summaries, prompt scrubbing, broad source-like output suppression including non-JS snippets, dotenv/access-token/JWT redaction, codex package tests passing, codex package typecheck passing, root lint passing, and root format check passing.

`TASK-059` has now implemented the mocked Codex adapter with deterministic fixture writes under `worktreePath`, unsafe path and real `.env` rejection, secret-looking `.env.example` template rejection, symlink escape rejection, synthesized safe summaries, codex package tests passing, codex package typecheck passing, root lint passing, and root format check passing.

`TASK-060` has now wired Codex adapter selection into the runner flow. Non-dry-run execution now runs Codex after a passing dry run and successful worktree creation, emits schema-valid metadata-only Codex start/finish events, returns safe Codex result metadata, preserves dry-run non-mutation, and still stops before change scanning, validation, commit, push, or PR creation.

`TASK-061` has now added the runner-local changed-file scanner. It runs `git status --porcelain=v1 -z --untracked-files=all`, reports added, modified, deleted, and untracked path metadata only, omits unsafe path text with `omittedPathCount`, fails closed on untrusted Git output, and keeps raw diffs, patches, command summaries, file contents, and source-like payloads out of serialized results.

`TASK-062` has now added the runner-local `.env` hard-block detector. It blocks `.env`, `.env.*`, `local.env`, and `*.local.env` by changed-path basename without reading contents, inspecting diffs, or relying on repo policy; `.env.example` remains allowed.

`TASK-063` has now added the runner-local suspected secret detector. It scans changed file contents locally under the worktree only, skips unsafe paths, missing files, directories, symlinked files, and symlinked path directories, emits fixed-category blocked `RiskFinding` objects without matched values or snippets, catches lower/mixed-case secret assignments, and keeps the detector uncomposed until the later safety-gate wiring tasks.

`TASK-064` has now added the runner-local protected path safety gate. It evaluates changed paths against a protected-only copy of repo policy, emits schema-valid blocked `protected_path` findings with changed paths only, ignores sensitive and warning matches for this task, fails closed with a generic pathless finding on unsupported protected glob syntax, and keeps the detector uncomposed until the later safety-gate wiring tasks.

`TASK-065` has now added the runner-local warning path classifier. It evaluates changed paths against repo warning paths plus conservative built-in patterns, emits schema-valid warning-only findings for package locks, migrations, infrastructure, auth, and billing paths, normalizes Windows separators and duplicate paths, keeps policy patterns and raw artifacts out of serialized output, and remains uncomposed until `TASK-067`.

`TASK-066` has now added the runner-local change-size gate. It counts changed files plus omitted paths, parses tracked and untracked Git shortstat metadata through direct argv calls, emits schema-valid large-diff warnings for policy threshold breaches, fails closed with a pathless blocker when evaluation cannot be trusted, exports through the runner entrypoint, and keeps raw diffs, patches, source-like keys, command output, and secret text out of serialized results.

`TASK-067` has now composed the runner-local change scan result. It combines changed-file metadata, `.env` blockers, suspected-secret blockers, protected-path blockers, warning-path findings, and change-size findings into a single safe result object without serializing raw diffs, patches, snippets, command output, or file contents.

`TASK-068` has now wired the composed change scan into the runner flow. Non-dry-run execution scans the worktree after Codex implementation and before review, validation, commit, push, or PR creation, stops on blockers, records safe quality artifacts, and keeps warnings visible without weakening validation gates. The next open implementation task is `TASK-069`.

`TASK-069` has now verified the safety gate milestone with focused changed-file, `.env`, suspected secret, protected path, warning path, change-size, composed scan, and script-level quality-gate tests. The runner also now covers bookkeeping-only milestone tasks so no-change verification tasks can complete through the merge queue without failing on an empty source commit.

`TASK-087` has now added event redaction enforcement for the runner event stream. Event messages and metadata are redacted before schema validation and persistence, low-entropy values under secret-like keys are replaced, and unsafe metadata keys remain blocked after redaction so web-bound run events cannot carry raw source, patches, or secrets.

`TASK-091` has now added the local bare remote fixture harness so runner integration tests can exercise branch push behavior against filesystem-backed remotes without external GitHub credentials.

A long-running auto-merge run previously completed `TASK-014` through `TASK-020` and paused safely at `TASK-021` after the larger RunnerProtocol implementation exhausted two 10-minute Codex implementation attempts. No unreviewed TASK-021 work was merged at that point. The runner now supports a configurable Codex phase timeout through `--codex-timeout-ms=` and keeps timeout failure artifacts concise while preserving the timeout reason.

The previous long-running auto-merge run completed `TASK-006`, `TASK-008`, `TASK-009`, `TASK-010`, `TASK-011`, `TASK-012`, and `TASK-013`. It paused during `TASK-014` after exposing a review-parser issue where an explicit `PASS` review could be misread as blocked when explanatory text mentioned read-only sandbox limitations. The runner now trusts first-line review verdicts before scanning explanatory text, and `TASK-014` has since been completed in an isolated task worktree.

## Long-Running Stability

The runner has been hardened for longer local runs after the TASK-005 timeout exposed gaps in timeout handling and cleanup.

Implemented hardening:

- Process-group timeout handling: terminate nested child processes as a group, not only the direct Codex process.
- Structured timeout artifacts: write concise timeout summaries with phase, task id, retry status, and the timeout reason without preserving noisy Codex startup streams.
- Retry and resume policy: retry transient Codex failures in a bounded way, and reuse existing task branches/worktrees and PRs where safe.
- Configurable timeout budgets: allow longer Codex phases for larger tasks through `--codex-timeout-ms=`.
- Automatic cleanup after auto-merge: remove local worktrees, local task branches, and merged remote task branches when safe.
- Idempotent PR and branch handling: detect existing branches or PRs for the same task before creating duplicates.
- Runner lock file: prevent two local runner processes from operating on the same backlog at the same time.
- README freshness enforcement: hard-block backlog-moving changes unless `README.md` is updated in the same changeset.
- Validation command parsing: execute explicit backticked commands, support multiple listed commands, and keep prose-only validation as reviewer guidance.
- `.env.example` handling: allow configuration templates while continuing to block real local environment files.
- Changed-file expansion: report individual untracked files rather than collapsed directories so quality gates can see new tests.
- Review verdict parsing: trust explicit first-line `PASS` and `BLOCKED` verdicts before scanning explanatory text for fallback signals.
- Merge verification expansion: include `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, and `pnpm test`.
- Failure classification: distinguish timeout, validation failure, policy block, dirty repo, unavailable tool, and Codex execution failure.
- Concurrent scheduling hygiene: normalize markdown-wrapped `Files Likely Touched` paths so `BACKLOG.md` and `README.md` bookkeeping entries do not accidentally serialize otherwise independent tasks.
- Merge-queue dependency preparation: rerun worktree dependency preparation after refreshing a queued branch from latest `main`, so newly introduced workspace packages are available before full merge validation.
- No-change milestone handling: route concurrent verification-only tasks through bookkeeping-only queue commits instead of failing on an empty source commit.

Still worth improving before very long unattended runs:

- Phase-specific timeout defaults for planning, implementation, review, and fix phases.
- Cancellation checks before and after every expensive phase, including dependency installation.
- Richer health logging for phase durations and next-task decisions.
- A deterministic dependency-change strategy for tooling-heavy tasks like `TASK-005`.

For longer runs, start with a bounded retry budget:

```bash
pnpm codex-runner -- --limit=5 --approve-plan --auto-merge --codex-attempts=2
```

For larger contract tasks, use a longer Codex phase budget:

```bash
pnpm codex-runner -- --limit=5 --approve-plan --auto-merge --codex-attempts=2 --codex-timeout-ms=1800000
```

## Key Documents

- [AGENTS.md](AGENTS.md): mandatory execution rules for agents and the runner.
- [BACKLOG.md](BACKLOG.md): local source of truth for task execution.
- [MVP_PLAN.md](MVP_PLAN.md): MVP scope and build direction.
- [ARCHITECTURE.md](ARCHITECTURE.md): system architecture and package boundaries.
- [DATA_MODEL.md](DATA_MODEL.md): core product data model.
- [RUNNER_PROTOCOL.md](RUNNER_PROTOCOL.md): runner coordination protocol.
- [SECURITY_MODEL.md](SECURITY_MODEL.md): trust boundary and security rules.
- [SPRINT.md](SPRINT.md): current sprint plan.
- [docs/CODEX_RUNNER.md](docs/CODEX_RUNNER.md): local backlog runner usage and behavior.

## Local Commands

Install dependencies:

```bash
pnpm install
```

Run checks:

```bash
pnpm run typecheck
pnpm run format:check
pnpm run lint
pnpm test
```

Dry-run the next backlog task:

```bash
pnpm codex-runner -- --limit=1 --dry-run
```

Generate a plan without implementation:

```bash
pnpm codex-runner -- --limit=1
```

Run one approved task with verified auto-merge:

```bash
pnpm codex-runner -- --limit=1 --approve-plan --auto-merge
```

Open the read-only local runner dashboard:

```bash
pnpm codex-runner-dashboard
```

Last completed task: `TASK-160` — Add Ready-for-AI filter.

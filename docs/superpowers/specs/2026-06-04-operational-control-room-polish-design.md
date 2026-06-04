# Operational Control Room Polish Design

Last updated: June 4, 2026

## Purpose

Polish the Cortex MVP UI so the production app feels like a disciplined engineering control
room during signup, workspace onboarding, repository scanning, setup PR review, and run
approval. The work must preserve the existing MVP scope: no hosted source execution, no new
post-MVP integrations, no new billing flow, and no source-like data exposure.

## Visual Thesis

Cortex should feel precise, calm, and operational: bright surfaces, crisp status rails,
compact information density, and clear hierarchy around what can safely move forward.

The palette stays light and restrained. The app should avoid decorative marketing chrome,
large rounded card mosaics, and one-note gradients. Product confidence comes from structure,
status clarity, and trust-boundary language.

## Scope

- Public landing page: stronger first impression, clearer product signal, and an app-like
  preview of the safety loop.
- Authenticated shell: improved navigation hierarchy, active states, and operational context.
- Dashboard overview and repo-readiness onboarding: clearer command-center composition,
  better action rows, stronger safe-boundary status, and more scannable metrics.
- Reusable primitives where useful: status rail, surface/panel treatment, empty-state rhythm,
  and tighter button/table readability.

## Non-Goals

- Do not add product features outside the MVP backlog.
- Do not change Auth0, Supabase, GitHub App, runner, or database behavior as part of visual
  polish.
- Do not introduce broad marketing sections, fake metrics, testimonials, pricing, or new
  integration promises.
- Do not expose raw source, diffs, patches, snippets, `.env` contents, secrets, private keys,
  provider response bodies, or unredacted command output.

## Surface Design

### Public Entry

The first viewport should immediately communicate Cortex as an AI engineering control plane.
Keep the existing sign-in/sign-up links and dashboard return target. Add a compact product
preview showing the safe flow:

1. Repo readiness scan.
2. AI-ready task approval.
3. Local runner execution.
4. Validated setup PR.

The preview should be code-native UI, not a static screenshot. Use concise operational copy,
small status labels, and no decorative hero card soup.

### App Shell

Keep the left navigation and mobile horizontal nav. Improve scan hierarchy by grouping the
brand block, readiness path, execution path, and settings/audit destinations through spacing
and quieter labels. Active nav should be obvious without overwhelming the page.

### Dashboard Overview

The overview should lead with the current operational question and then show:

- A trust-boundary status strip.
- Recommended next actions with left status rails and clearer counts.
- Summary metrics that are compact and comparable.
- Run lists and runner health in the existing two-column layout.

Avoid a marketing hero inside the app. This is an operator workspace.

### Repo Readiness Onboarding

The first authenticated empty state should feel useful before runner installation. Preserve
the repository radio list and product-goal textarea, but strengthen the surrounding hierarchy:
metadata-only scan, scan-only GitHub access, and runner optional later.

## Interaction

- Navigation, action rows, and buttons should have subtle hover/focus states.
- Selected/active states should be visible through color plus structure, not color alone.
- Status rails should make blocker/warning/success/neutral items easy to scan.
- Motion is optional and should remain restrained; no animation is required for this pass.

## Verification

Run focused UI/source tests for the changed surfaces, then full typecheck/lint/format/test.
Start the local web app and verify the public entry, dashboard fallback/onboarding where
available, desktop viewport, and mobile viewport. Capture screenshots and compare them
against this design brief for:

- First-screen product signal.
- Auth links and dashboard return preservation.
- Trust-boundary language.
- Layout density and scannability.
- No text overlap or mobile overflow.
- No secret/source-like payload leakage.

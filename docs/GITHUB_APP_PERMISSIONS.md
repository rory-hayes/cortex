# GitHub App Permissions

## Purpose

This document is the canonical GitHub App permission review for repo-readiness scanning. The review keeps scan-only repository access separate from later setup-PR authority and optional PR/check visibility.

The least-privilege rule is the default: request the smallest selected-repository permission set that supports the current mode. No runner installation is required for scan-only mode.

The review layer uses GitHub App installation permission metadata only. Hosted surfaces may store metadata and evidence summaries only; they must never store raw source, diffs, patches, snippets, secrets, private keys, `.env` contents, tokens, or unredacted command output.

## Permission List

| Mode          | Required repository permissions                             | Runner required | Purpose                                                                                                                   |
| ------------- | ----------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Scan-only     | `metadata: read`, `contents: read`                          | No              | Read repository metadata and source file metadata/content needed to produce readiness findings and setup recommendations. |
| Setup-PR      | `metadata: read`, `contents: write`, `pull_requests: write` | No              | Later elevated path for approved, template-bounded setup PR generation. This is not general hosted source execution.      |
| PR visibility | `pull_requests: read`, `checks: read`                       | No              | Optional read-only PR and check status visibility after PRs exist.                                                        |

## Scan-Only Matrix

| Permission      | Access  | Required | Notes                                                   |
| --------------- | ------- | -------- | ------------------------------------------------------- |
| `metadata`      | `read`  | Yes      | Baseline GitHub App repository metadata.                |
| `contents`      | `read`  | Yes      | Allows repo-readiness scanning without write authority. |
| `contents`      | `write` | No       | Excessive for scan-only mode.                           |
| `pull_requests` | `write` | No       | Not needed for scan-only mode.                          |
| `checks`        | `write` | No       | Not part of MVP scan-only mode.                         |

Scan-only mode can run before runner pairing. It must not require repository write permissions, hosted code execution, raw file inventories, diffs, patches, snippets, secrets, `.env` values, or unredacted logs.

## Setup-PR Matrix

| Permission              | Access  | Required | Notes                                                                    |
| ----------------------- | ------- | -------- | ------------------------------------------------------------------------ |
| `metadata`              | `read`  | Yes      | Baseline GitHub App repository metadata.                                 |
| `contents`              | `write` | Yes      | Required only for approved setup PR file changes.                        |
| `pull_requests`         | `write` | Yes      | Required only to open setup PRs.                                         |
| `administration`        | Any     | No       | Rejected for MVP profiles.                                               |
| `secrets`               | Any     | No       | Rejected for MVP profiles.                                               |
| `actions` / `workflows` | `write` | No       | Rejected for MVP profiles unless a separate approved task changes scope. |

Setup-PR mode is a later, template-bounded path for repository setup work. It must not become arbitrary hosted repository writes and does not replace the local runner for approved source-code execution.

## PR Visibility Matrix

| Permission      | Access  | Required | Notes                        |
| --------------- | ------- | -------- | ---------------------------- |
| `pull_requests` | `read`  | Yes      | Reads PR status metadata.    |
| `checks`        | `read`  | Yes      | Reads check status metadata. |
| `checks`        | `write` | No       | Rejected for MVP profiles.   |
| `issues`        | `write` | No       | Rejected for MVP profiles.   |

PR visibility is optional and read-only. Missing PR/check visibility must not block scan-only readiness.

## Explicitly Rejected MVP Permissions

These permissions are not part of the MVP profiles and must be flagged as excessive when present:

- `administration` at any granted access level
- `secrets` at any granted access level
- `actions: write`
- `workflows: write`
- `checks: write`
- `issues: write`

Any future request for these permissions needs a separate approved task with a narrower scope and updated security review.

## Selected-Repository Installation Guidance

Install the GitHub App on selected repositories whenever possible. Scan-only onboarding should ask for only the repositories a user wants Cortex to evaluate. Broad organization access, all-repository installation, organization/member permissions, and administration-like permissions are out of scope for this MVP review.

## Source References

- GitHub App permission selection guidance: <https://github.com/github/docs/blob/main/content/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app.md>
- GitHub REST permission tables for GitHub Apps: <https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps>
- GitHub App installation metadata includes the installation permissions object used by the review layer: <https://docs.github.com/en/rest/apps/installations>

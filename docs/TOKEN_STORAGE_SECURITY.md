# Token Storage Security

This document records the MVP token and secret storage boundary for the hosted Cortex
coordinator and the local runner. It is intentionally about storage and exposure rules, not
about real secret values.

## Core Rule

Secrets stay server-side, local-runner-side, or in the operator-controlled runtime where they
are needed. Hosted UI surfaces, client bundles, run events, task packets, audit metadata, and
validation summaries must stay metadata-only.

## Runner Pairing And Credentials

- Runner pairing codes are short-lived and one-time use.
- Pairing code values are hashed before lookup or persistence.
- The runner credential is returned once during linking.
- The raw runner credential belongs in the local runner's ignored local runner config.
- The web app stores only a hash for later runner authentication.
- Runner credentials must not be logged, rendered, returned by list APIs, copied into run
  events, or imported into client bundle code.

## GitHub Credentials

- Source-changing implementation uses the customer's local `git` / `gh` credentials through
  the local runner.
- GitHub App id, private key, webhook secret, and installation access token handling are
  server-side environment responsibilities for hosted metadata and setup-PR flows.
- GitHub installation access tokens are transient transport credentials.
- GitHub App visibility and setup-PR persistence must store metadata-only repository,
  issue, branch, PR, check, and audit fields.
- GitHub webhook secret values must be read only by the webhook route handler and must not
  leave request verification code.

## Linear OAuth Tokens

- Linear OAuth access token and refresh token values are accepted only by server-side code.
- Tokens are sealed/encrypted before storage and persisted only as ciphertext with a key id.
- Revoked Linear connections must clear access-token ciphertext, access-token key id,
  refresh-token ciphertext, and refresh-token key id values.
- Linear tokens must never reach client components, run events, task packets, audit metadata,
  or logs.

## Auth0 And Browser Environment

- Auth0 client id, client secret, tenant domain, and session-cookie secret are configured
  through server-side runtime environment values.
- `AUTH0_CLIENT_SECRET` and `AUTH0_SECRET` are server-only.
- The current Auth0 SDK integration does not require browser-visible auth environment values.
- Client components must not import server credential modules or read server secret
  environment names.

## Database Credentials

- `DATABASE_URL` is server-only.
- Database helpers must remain behind `import "server-only";`.
- The app must not define `NEXT_PUBLIC_DATABASE_URL`.
- Database connection strings must not appear in client bundle code, errors, validation
  summaries, audit metadata, or run events.

## Environment Examples

- `.env.example` files must use placeholders only.
- Public environment placeholders are limited to deliberately public values. The current Auth0
  setup keeps auth credentials server-side and does not define public auth placeholders.
- Placeholder docs must not include real credentials, API keys, private keys, database
  passwords, bearer tokens, or provider tokens.

## Out Of Scope

Enterprise secret manager integration is out of scope for the MVP token-storage rules in this
task. The current requirement is to keep the hosted coordinator metadata-only, keep server
credentials server-side, and keep source-changing execution credentials local to the runner.

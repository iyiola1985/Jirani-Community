# Deployment readiness

This note is an audit of what a staging host needs. The operator checklist is `docs/staging-checklist.md`. It is not a record of a deployment. Nothing in this review was deployed, no migration was run, and Daraja was not contacted.

Labels:

- **Verified.** Observed in this repository.
- **Assumption.** A reasonable operating choice this repository does not configure.
- **Unverified.** Not checked against a live staging host.

## Architecture and services

**Verified.** Jirani is a Next.js 16.4.3 App Router application (`jirani-app`) with React 19, TypeScript, and Tailwind CSS 4. The server talks to PostgreSQL through `pg`. Authentication can use local accounts in that database, or Supabase Auth when the public Supabase variables are set. There is no Dockerfile, no platform manifest, and no process manager in the repository.

Scripts:

| Script | Command | Role |
| --- | --- | --- |
| `dev` | `next dev` | Local development only. |
| `build` | `next build` | Production compile. |
| `start` | `next start` | Production server. Sets `NODE_ENV=production`. |
| `migrate` | `node scripts/migrate.mjs` | Applies `db/migrations/*.sql` as the database owner. |
| `test`, `lint`, `typecheck` | Vitest, ESLint, `tsc --noEmit` | Checks. Not part of the running server. |

A staging host that matches the current code needs:

1. A long-running Node process for `npm run build` and `npm run start`.
2. PostgreSQL, with migrations `0001` through `0012` already applied by the database owner.
3. A persistent disk for private evidence and reviewed campaign images. The app writes both to the local filesystem.
4. HTTPS terminated in front of the Node process.

Supabase Auth is optional. SMS is not connected. Daraja is not a staging dependency. The labelled simulated gift and the mock sandbox stay in the application and do not call Safaricom.

**Verified limitation.** Serverless hosting does not fit this tree. Private evidence is stored under `storage/private-evidence`, campaign images are written under `public/campaign-images`, and sign-in rate limits live in process memory. A host that discards the filesystem between requests, or that runs more than one instance without a shared disk, will lose files and will not share the rate limit. This audit does not move the database or pick a host.

## Environment variables

Names only. Values stay in the host's secret store or in `.env.local` on a developer machine. `.env.example` lists the names with empty values.

**Verified.** These names are read by the server. Only the three `NEXT_PUBLIC_` names are eligible for browser code.

| Name | Staging use |
| --- | --- |
| `DATABASE_URL` | Connection string for the running app. Use the `jirani_app` role, not the database owner. |
| `SESSION_SECRET` | Required when `NODE_ENV=production`. At least 32 characters. Signs the local session cookie. |
| `MOCK_PROVIDER_SECRET` | Required when `NODE_ENV=production`. At least 16 characters. Signs the labelled simulated-gift callback. |
| `DEMO_MODE` | Production must set `false`. Demonstration sign-in is off in production even if this is `true`, and the process refuses to start unless it is exactly `false`. Outside production, only the exact value `true` turns demonstration accounts on. |
| `NEXT_PUBLIC_SITE_URL` | Public `https` origin, with no username, password, path, query, or hash. Production refuses localhost and private hosts. Used for email links when Supabase Auth is configured. |
| `NEXT_PUBLIC_SUPABASE_URL` | Leave empty to keep local Postgres accounts. Set only when Supabase Auth is the intended sign-in. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Pair with the Supabase URL. Safe to expose. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. The admin client is defined and is not called by a route. Leave empty unless a later server script needs it. |
| `SANDBOX_PROVIDER` | Leave empty on a public staging host. `mock` enables the separate signed sandbox. `daraja` stays disabled. |
| `SANDBOX_WEBHOOK_SECRET` | Required only when `SANDBOX_PROVIDER=mock`, and then at least 16 characters. |
| `DARAJA_SANDBOX_CONSUMER_KEY` | Optional. Does not enable a request. |
| `DARAJA_SANDBOX_CONSUMER_SECRET` | Server only. Does not enable a request. |
| `DARAJA_SANDBOX_PASSKEY` | Server only. Does not enable a request. |
| `DARAJA_SANDBOX_SHORTCODE` | Optional. Does not enable a request. |
| `DARAJA_SANDBOX_CALLBACK_URL` | Leave empty. A public URL does not enable Daraja. |
| `DARAJA_SANDBOX_INITIATOR` | Leave empty while Transaction Status stays disabled. |
| `DARAJA_SANDBOX_SECURITY_CREDENTIAL` | Server only. Not the STK passkey. Leave empty. |
| `DARAJA_SANDBOX_RESULT_URL` | Leave empty. |
| `DARAJA_SANDBOX_TIMEOUT_URL` | Leave empty. |

`classifySandboxConfig` types Daraja as `ready: false`. `DARAJA_SANDBOX_SEND_ENABLED` and `DARAJA_TRANSACTION_STATUS_SEND_ENABLED` are `false`. `DARAJA_LEDGER_POSTING_ENABLED` is `false`. Filling in credentials does not change those flags. Production routes do not import the Daraja HTTP client.

When the Node server starts with `NODE_ENV=production`, `src/instrumentation.ts` refuses to serve until `DEMO_MODE` is `false`, `DATABASE_URL` is a PostgreSQL connection string, `SESSION_SECRET` and `MOCK_PROVIDER_SECRET` are unique and long enough, and `NEXT_PUBLIC_SITE_URL` is a public `https` origin. The check does not print those values. `next build` does not run it. Demonstration passwords are not rendered, and `authenticateDemo` returns no account, whenever `NODE_ENV` is `production`.

## Database and migrations

**Verified.** `npm run migrate` applies each file in `db/migrations` in its own transaction and records the filename in `schema_migrations`. Re-running skips files already recorded. The app role is `jirani_app`, created with row-level security forced. Password hashes live in `auth_credentials`, which `jirani_app` cannot read directly. Login uses `jirani.account_for_login`, a security-definer function that returns the hash to the server for a scrypt check. The hash is not sent to the browser.

Run migrations as the database owner. Do not point the running app at the owner role. After `0012_daraja_posting_gate.sql`, `jirani.apply_sandbox_verification` returns `disabled` for any provider other than `sandbox-mock` before it writes a contribution, refund, or ledger row. `jirani.require_ledger_writer` accepts a verified insert only when the provider is `sandbox-mock` and the row is simulated.

The first administrator is created by the owner, not by registration:

```sql
SELECT jirani.bootstrap_administrator('<user-uuid>');
```

`bootstrap_administrator` is not granted to `jirani_app`. Later grants use `jirani.assign_role`, which rejects a person granting administrator to themselves.

**Assumption.** A remote database needs TLS in `DATABASE_URL` (`sslmode`) and a firewall that allows only the app host. This repository does not set those.

**Unverified.** Whether a staging database already has `0001` through `0012`. This audit did not connect or migrate.

## Authentication and admin access

**Verified.** The session cookie `jirani_session` is `httpOnly`, `SameSite=Lax`, path `/`, and lasts seven days. `secure` is set when `NODE_ENV=production`. Roles are reloaded from the database or from Supabase `user_roles`. The cookie does not grant a role by itself.

`src/proxy.ts` redirects unsigned visitors only for `/dashboard/:path*`. Each dashboard page then calls `guardDashboard` for recipient, donor, corporate partner, or administrator. Administrator pages, including finance, reconciliation, campaigns, payments, and request review, require the administrator role. Evidence downloads check the actor again. A donor cannot open an administrator page by URL.

Registration accepts `recipient`, `donor`, or `corporate_partner`. It does not accept `administrator`. When Supabase Auth is configured, sign-in tries Supabase first. Local Postgres sign-in is used when `DATABASE_URL` is set. Demonstration accounts are used only when `NODE_ENV` is not `production` and `DEMO_MODE` is exactly `true`. They are not database profiles. A local demonstration banner is shown only in that case.

Sign-in attempts are limited in memory to 8 per ten minutes for each client address and email. That limit resets when the process restarts and is not shared across instances.

## Private files

**Verified.** Supporting documents are written outside `public/`, under `storage/private-evidence`, with a generated name of the form `<uuid>.pdf|jpg|png|webp|mp4|webm`. The directory is gitignored. There is no public URL for a storage key. Images are limited to 10 MB, PDFs to 15 MB, and videos to 50 MB. Migration `0013_evidence_review.sql` adds categories and review status. It was not applied to the local database by this change.

Downloads:

| Who | Path | Check |
| --- | --- | --- |
| Administrator | `/dashboard/admin/requests/[id]/evidence/[evidenceId]` and `/dashboard/admin/campaigns/[id]/evidence/[evidenceId]` | Signed-in administrator who does not own the file, then the evidence row visible to that actor. |
| Recipient | `/dashboard/recipient/requests/[id]/evidence/[evidenceId]` | Signed-in owner, then the same row check. |

Responses use `Content-Disposition: attachment`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, and a sandbox content security policy. Row-level security on `private_evidence_metadata` allows the owner or an administrator to read. Review status changes go through `jirani.review_private_evidence`. Donors have no policy on that table. No malware scanner is configured, and video duration is not measured.

Reviewed campaign images are different. An administrator upload is stored under `public/campaign-images` and can be fetched by its generated path. That is intentional for images already approved for a public campaign. Those uploads are gitignored except for the folder placeholder.

**Assumption.** The staging process user must be able to create and read `storage/private-evidence` and `public/campaign-images`, and backups must copy both directories with the database. The app does not sync them to object storage.

## Logging, errors, backups, and recovery

**Verified.** Unexpected server failures are written with `console.error` in request, campaign, ledger, sandbox, and form handling. The message returned to the visitor is generic. Sign-in does not log the password or the password hash. Application code does not print `DATABASE_URL`, Daraja secrets, or the Supabase service role key. Browser bundles can see only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SITE_URL`.

A Postgres error object can include the SQL text. Treat process logs as private. This repository does not ship a log redaction layer or an error tracker.

**Assumption for recovery.** Take a logical dump as the database owner, and copy `storage/private-evidence` and `public/campaign-images` at the same time. Restore the dump into an empty database as the owner, confirm `schema_migrations` contains `0001` through `0012`, put the files back, then start the app as `jirani_app`. Do not replay migrations that are already recorded. The app has no backup job of its own.

There is no health-check route. A staging probe can use the public homepage until one is added.

## HTTPS, domain, and deployment shape

**Verified.** The app does not terminate TLS and does not set HSTS or a content-security policy. Put it behind an HTTPS proxy. In production, `siteOrigin()` uses only `NEXT_PUBLIC_SITE_URL` after the public `https` check. Outside production, an empty site URL still falls back to `x-forwarded-host` or `http://localhost:3000`. The proxy must overwrite those forwarded headers on a development machine.

`next start` is the production server. `next dev` is not. The production compile does not require a local database, a callback host, or Daraja credentials. Missing `SESSION_SECRET` or `MOCK_PROVIDER_SECRET` fails later, when a session or a simulated gift is signed, not during `next build`.

Compatible shape, without choosing a vendor:

- One Node server, or a container that runs `next start`, with a durable volume for the two storage directories.
- PostgreSQL reachable with TLS, app role `jirani_app`, owner used only for migrations and `bootstrap_administrator`.
- An HTTPS reverse proxy and a hostname recorded in `NEXT_PUBLIC_SITE_URL`.

Leave Supabase unset to keep the current local-account design. Adding Supabase Auth later does not require moving the ledger. This audit does not create a project there.

Leave `SANDBOX_PROVIDER` empty. The mock sandbox can post a ledger gift after a valid signature, and that path should stay off a public staging host until someone deliberately turns it on. The labelled simulated gift on a published request remains available to a signed-in donor.

## Public data

**Verified.** Anonymous database reads run without a profile or role setting, so row-level security applies.

Published request pages select the public alias, category, title, public summary, county, locality, amount, currency, urgency, published time, demonstration flag, and the ledger total. They do not select the private note, review notes, phone, email, evidence, or recipient id. Drafts are not returned. Locality is a public field. The request form rejects a phone, an email, a long number, and a few street words (`plot`, `house number`, `apartment`, and similar) in that field. It does not detect every street address.

Campaign pages that visitors can open are limited by policy to scheduled, active, closed, reconciling, reported, and cancelled campaigns that were approved. Drafts and unapproved campaigns stay hidden. The public columns are the campaign explanation, county, target, ledger total, dates, status, and image path. Selection rows and reconciliation notes are administrator-only. A published report shows the narrative and the separate raised, fee, allocated, and paid figures. The campaign form does not run the same public-text filter as an assistance request. Administrators are told to leave phone numbers and account numbers out of the report.

Public gift names come from `jirani.public_acknowledgements` and `jirani.public_campaign_acknowledgements`. Those functions return the chosen public name, or `Anonymous`, and only for a successful simulated gift. They do not return the donor's account name or email. Donor history and administrator finance pages are behind `guardDashboard`.

Sandbox payment rows are visible to the paying donor or an administrator. Anonymous visitors cannot select them.

## Blockers before a public staging launch

These are unresolved. This note does not remove them.

1. **No deployment has been made.** There is no git repository in this directory, no remote, and no host configuration. `.gitignore` ignores `.env*` except `.env.example`, ignores `storage/`, and ignores uploaded campaign images.
2. **The production process must be given `DEMO_MODE=false` plus the other required variables.** It now refuses to start without them, and demonstration accounts cannot sign in when `NODE_ENV=production`. The values still have to be supplied on the host. This repository does not invent them.
3. **Secrets must be set on the host, not invented here.** `DATABASE_URL` for `jirani_app`, a unique `SESSION_SECRET` of at least 32 characters, a unique `MOCK_PROVIDER_SECRET` of at least 16 characters, and `NEXT_PUBLIC_SITE_URL` as the real public `https` origin.
4. **Migrations `0001` through `0012` must be applied by the owner** on the staging database, and one real administrator must be bootstrapped there. This audit did not run that.
5. **Persistent storage** for `storage/private-evidence` and `public/campaign-images`, plus a backup of those files with the database.
6. **HTTPS proxy** that sets the forwarded host and protocol, because the app does not terminate TLS or send HSTS.
7. **Leave Daraja unset or present but unused.** Credentials must not be treated as permission to send. Callback URLs stay empty. See `docs/daraja-readiness.md`.
8. **Leave `SANDBOX_PROVIDER` empty** until a separate decision to expose the mock webhook.
9. **Support address and policy version are still placeholders** (`hello@jirani.example`, `draft-2026-10`).
10. **Single-process limits.** The rate limit and the evidence files assume one server with a disk. A second instance needs shared storage before it is added.

## Safety check for this note

**Verified in the current tree.** Daraja sending flags stay `false`. The ledger gate and migration `0012` still refuse Daraja contributions, refunds, and ledger entries. Mock sandbox posting stays a separate path and is off unless `SANDBOX_PROVIDER=mock`. No provider request is part of staging configuration.

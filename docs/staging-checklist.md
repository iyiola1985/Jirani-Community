# Staging deployment checklist

Planning only. This file does not deploy Jirani, create a host, or change credentials. Daraja stays disabled. Use a new staging database and staging hostname. Do not copy the local database or any existing donor, recipient, or gift rows into it.

Labels:

- **Verified.** Observed in this repository or in Next.js 16.4.3's own package metadata.
- **Confirm.** Required for this app, but this repository cannot prove a hosting account provides it.

## 1. Runtime

**Verified.** Next.js 16.4.3 declares `node >= 20.9.0`. There is no Dockerfile and no process manager in the repository.

| Action | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Compile | `npm run build` |
| Serve | `npm run start` |

`npm run start` runs `next start` and sets `NODE_ENV=production`. `npm run dev` is local only. The process listens on port 3000 unless `PORT` is set. Keep one process. Sign-in limits and uploaded files are not shared across processes.

**Confirm.** The host offers Node.js 20.9 or newer and keeps that process running. The installed Supabase client warns that Node.js 20 will stop being supported and asks for Node.js 22. The current application build still completes on Node.js 20. Prefer 22 only after confirming `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` on that version.

Set `NEXT_PUBLIC_SITE_URL` before `npm run build`. Next.js bundles `NEXT_PUBLIC_` values for the browser at build time. Set the same value again for `npm run start`. Rebuild if the staging hostname changes.

## 2. PostgreSQL and the runtime role

**Verified.** The app uses the `pg` driver and a pool of 5 connections. The migration `0001_init.sql` creates the role `jirani_app` as `NOLOGIN` when it does not already exist. Row-level security is forced. A superuser bypasses that security, so the web process must not use the database owner.

The migrations do not set a password and do not turn `LOGIN` on. After they succeed, the owner has to do that once:

```sql
ALTER ROLE jirani_app WITH LOGIN PASSWORD '<a new password stored only on the staging host>';
```

The running app's `DATABASE_URL` must use `jirani_app`. The owner connection is only for migrations and `jirani.bootstrap_administrator`.

**Verified local baseline.** These migrations were applied locally on PostgreSQL 14. Use PostgreSQL 14 or a newer major version.

**Confirm.** The staging database is a new, empty database, not the local `jirani` database. The host allows the owner to create a role, and it allows `jirani_app` to connect with TLS (`sslmode=require` on a remote database). If a connection pooler is in front of Postgres, confirm that one transaction stays on one server connection. The app sets its actor with `set_config` inside the transaction.

## 3. Apply migrations 0001 through 0012

Run this once, as the database owner, from a checkout of this repository. Point `DATABASE_URL` at the owner for this command only. Do not print that URL.

```bash
DATABASE_URL='<owner connection string>' npm run migrate
```

`scripts/migrate.mjs` applies each file in `db/migrations` in its own transaction and records the filename in `schema_migrations`. A second run prints `skip` for a recorded file. Do not delete rows from `schema_migrations` to force a replay.

Expected order:

1. `0001_init.sql`
2. `0002_auth_roles.sql`
3. `0003_local_accounts.sql`
4. `0004_request_details.sql`
5. `0005_audit_execute.sql`
6. `0006_financial_ledger.sql`
7. `0007_campaign_statuses.sql`
8. `0008_campaign_operations.sql`
9. `0009_campaign_reversal_lock.sql`
10. `0010_sandbox_payments.sql`
11. `0011_sandbox_payment_reference.sql`
12. `0012_daraja_posting_gate.sql`

Then, still as the owner, confirm:

```sql
SELECT id FROM schema_migrations ORDER BY id;
```

All 12 names above should be present. `0012_daraja_posting_gate.sql` keeps Daraja from creating a contribution, refund, or ledger entry. Do not edit it to widen `jirani_app`.

## 4. Persistent files, backup, and restore

**Verified paths**, relative to the process working directory:

| Path | Contents | Public |
| --- | --- | --- |
| `storage/private-evidence` | Request and campaign evidence. Generated names `<uuid>.pdf`, `.jpg`, `.png`, `.webp`, `.mp4`, or `.webm`. Images 10 MB, PDFs 15 MB, videos 50 MB. Apply migration `0013` before the new review columns are used. | No. Gitignored. No public URL. |
| `public/campaign-images` | Reviewed campaign images. JPEG, PNG, or WebP. Maximum 2 MB. | Yes, by the generated filename, after an administrator stores one. Uploaded files are gitignored. |

The process user must be able to create both directories. They must survive a redeploy. A second app instance needs the same disk. This repository does not upload them to object storage.

Backup the staging database and both directories at the same time:

1. `pg_dump` as the database owner.
2. Copy `storage/private-evidence` and `public/campaign-images`.

Restore into an empty database as the owner, put the files back, then start the app as `jirani_app`. If the dump includes `schema_migrations`, do not run `npm run migrate` again. The app has no backup job.

**Confirm.** The host's disk survives restarts and redeploys, and you have a place to store the dumps that is not the application directory.

## 5. HTTPS proxy and forwarded headers

**Verified.** The app does not terminate TLS and does not send HSTS. `npm run start` can listen on HTTP behind a proxy. Browsers must use the staging `https` origin. The session cookie is `secure` when `NODE_ENV=production`.

In production, `siteOrigin()` uses only `NEXT_PUBLIC_SITE_URL`. It does not trust `x-forwarded-host` or `x-forwarded-proto`.

Sign-in rate limiting reads the first address in `x-forwarded-for`. The limit is 8 attempts per address and email in 10 minutes, stored in that process. The proxy must replace `x-forwarded-for` with the connecting client address. A client-supplied value must not remain the first entry.

Proxy requirements:

- Certificate for the staging hostname.
- Forward traffic to the single Node port.
- Do not publish that Node port on the public internet when the proxy is the entry point.
- Send `x-forwarded-for` as the real client address.

**Confirm.** Certificate renewal, and that the proxy overwrites `x-forwarded-for`. HSTS is a proxy choice. The app will not set it.

## 6. Environment variable names

Set these on the staging host. Do not commit the values. Leave Daraja names empty.

Required before `npm run start` will serve:

| Name | Constraint |
| --- | --- |
| `DEMO_MODE` | Exactly `false`. |
| `DATABASE_URL` | PostgreSQL URL for `jirani_app`, not the owner. |
| `SESSION_SECRET` | Unique, at least 32 characters. Not the local development placeholder. |
| `MOCK_PROVIDER_SECRET` | Unique, at least 16 characters. Not the local development placeholder. |
| `NEXT_PUBLIC_SITE_URL` | Public `https` origin only. No user, password, path, query, or hash. Not localhost, a private address, `.test`, or `.example`. |

Leave empty for the first staging launch:

| Name | Why |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Empty keeps local Postgres accounts. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Pair only if Supabase Auth is deliberately enabled. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. No current route calls it. |
| `SANDBOX_PROVIDER` | Empty keeps the mock webhook off. `daraja` still does not send. |
| `SANDBOX_WEBHOOK_SECRET` | Used only when `SANDBOX_PROVIDER=mock`. |
| `DARAJA_SANDBOX_CONSUMER_KEY` | Does not enable a request. |
| `DARAJA_SANDBOX_CONSUMER_SECRET` | Server only. Does not enable a request. |
| `DARAJA_SANDBOX_PASSKEY` | Server only. Does not enable a request. |
| `DARAJA_SANDBOX_SHORTCODE` | Does not enable a request. |
| `DARAJA_SANDBOX_CALLBACK_URL` | Leave empty. |
| `DARAJA_SANDBOX_INITIATOR` | Leave empty. |
| `DARAJA_SANDBOX_SECURITY_CREDENTIAL` | Leave empty. |
| `DARAJA_SANDBOX_RESULT_URL` | Leave empty. |
| `DARAJA_SANDBOX_TIMEOUT_URL` | Leave empty. |

Use different `SESSION_SECRET`, `MOCK_PROVIDER_SECRET`, and database passwords from any later production host.

## 7. Administrator bootstrap

Do this with a new staging account. Do not import an existing person.

1. Register through the staging site as a recipient, donor, or corporate partner. Registration cannot choose administrator.
2. As the database owner, read that profile id:

```sql
SELECT id FROM profiles WHERE email = '<the new staging address>';
```

3. Grant administrator once:

```sql
SELECT jirani.bootstrap_administrator('<that uuid>');
```

`bootstrap_administrator` is not granted to `jirani_app`. The profile must exist first. Sign out and sign in again so the role is reloaded from `user_roles`. A later administrator is assigned with `jirani.assign_role`, which rejects a person granting administrator to themselves.

## 8. Staging domain and staging data

Pick a hostname you control, for example a `staging` name under a domain you already operate. Put that `https` origin in `NEXT_PUBLIC_SITE_URL`. Point DNS at the proxy only after the checklist above is done.

Use a database created for staging. Do not restore the local database into it. The first accounts, requests, gifts, and campaigns should be created through the staging site and labelled as tests. Do not use a real donor's identity, phone number, evidence, or payment history.

Leave Supabase unset unless you separately decide to test Supabase Auth. That choice does not move the ledger.

## 9. Checks after a future deployment

These are the checks to run on the staging origin. They are not a claim that a deployment has happened.

Public site:

- `https://<staging-host>/` loads, with no "Local demonstration only" banner.
- `/login` has no demonstration passwords.
- `/requests` and `/campaigns` do not show drafts.

Accounts:

- Register two new test accounts: one recipient and one donor.
- The ninth sign-in attempt for the same address and email, within ten minutes, is refused.
- A donor opening `/dashboard/admin` is refused.

Evidence:

- The recipient submits a request with a PDF or image inside the private evidence limit. Video is optional.
- The request is absent from `/requests` before publication.
- An anonymous request for `/dashboard/recipient/requests/<id>/evidence/<evidenceId>` is sent to sign-in.
- The donor receives "Not found" or an unauthorized response for the administrator evidence path.
- After bootstrap, the administrator can download that file. The response is not cached publicly.

Campaign:

- The administrator saves a draft. Its URL is not public.
- After it is scheduled or active, `/campaigns/<slug>` shows the public explanation and ledger totals.
- Closing it does not create a payout. Raised, allocated, and paid stay separate.

Money:

- The signed-in donor records a simulated gift on a published test request. The public total changes by that gift only.
- `SANDBOX_PROVIDER` is empty, so no sandbox pay button starts a provider payment.
- `POST /api/payments/sandbox/callback` with a Daraja-shaped body does not create a contribution. The database gate in `0012` remains in place.

## 10. Hosting shapes

Anything below is **confirm** with the provider. This repository does not select one and does not open an account.

| Shape | Fits the current app if confirmed | Must confirm |
| --- | --- | --- |
| One virtual machine, Node 20.9+, a reverse proxy, and PostgreSQL on that machine or on a private network | Yes. Closest match to the current process model. | Disk backups, firewall, certificate renewal, and that Postgres 14 or newer is available. |
| A platform that runs one long-lived `next start` process and mounts a volume at the application directory | Yes, when the volume is the working directory so both storage paths persist. | The volume survives redeploy, the plan does not scale past one instance, and the platform does not idle-sleep the process. |
| Managed PostgreSQL, separate from the app | Yes, as the database only. The app still needs its own disk. | Owner access, ability to create `jirani_app`, TLS, network allow-list, backup retention, and transaction-safe pooling. |
| Serverless or a host with an ephemeral filesystem | No, without a different storage design. | Do not choose this for the current tree. |

A container image is possible later. There is no image definition in the repository.

## 11. Actions before any deployment

1. Choose the staging hostname and a new empty database. Do not reuse the local database.
2. Confirm the host is one long-running Node process, Node.js 20.9 or newer, with a persistent disk and PostgreSQL 14 or newer.
3. Confirm the proxy terminates HTTPS and overwrites `x-forwarded-for`.
4. Generate new values for `SESSION_SECRET`, `MOCK_PROVIDER_SECRET`, and the `jirani_app` password. Store them on the host.
5. Set `DEMO_MODE=false`, `DATABASE_URL` for `jirani_app`, and `NEXT_PUBLIC_SITE_URL` to the staging `https` origin. Leave Supabase, `SANDBOX_PROVIDER`, and every `DARAJA_SANDBOX_*` name empty.
6. Run `npm run build` with the staging `NEXT_PUBLIC_SITE_URL`, then `npm run start` only after the owner migration below.
7. As the database owner, run `npm run migrate`, check `schema_migrations`, then `ALTER ROLE jirani_app WITH LOGIN PASSWORD`.
8. Register a new staging user and run `jirani.bootstrap_administrator` for that profile id.
9. Run the checks in section 9 with test accounts only.

Nothing in this checklist has been executed against a host.

# Jirani

Jirani is a community assistance platform for Kenya, operated by Shola Tech Ltd. People can ask for verified help, and donors can see labelled demonstration records of how a gift, a fee, and a refund would be tracked. This build does not send money or SMS, and it does not store a password in readable form.

## What works locally

- The public site, request and campaign discovery, and the labelled demonstration ledger.
- Sign-in for the demonstration accounts below. The session is an httpOnly cookie that expires after seven days. Roles are read from the account record, not from the cookie.
- Registration and sign-in against the local Postgres database when `DATABASE_URL` points at the `jirani_app` role. The password is stored as a scrypt hash in `auth_credentials`. The signed-in role is read from `user_roles`, and `/dashboard` opens the matching workspace.
- Assistance requests for registered recipients. A draft or submission is stored in Postgres, supporting files stay in `storage/private-evidence` outside the public site, and only an administrator can verify or publish. Demonstration accounts still use the labelled in-memory ledger.
- Simulated gifts on a published database request or an active database campaign. Amounts are integer cents. A successful simulation adds an append-only ledger row, and a reversal adds another row instead of editing the gift. The public total is calculated from those rows. Nothing is paid out.
- Monthly campaigns for a registered administrator: draft, review, schedule or open, close, reconcile, record one manual selection, and publish a report. Visitors see the public rules, the ledger total, and the separate raised, allocated, and paid figures. Closing a campaign does not send money.
- A sandbox payment adapter. With no provider configured, the request and campaign pages say so and do not mark a payment as paid. A configured mock accepts only a signed server callback before it posts one ledger gift. Daraja credentials do not start a payment. The STK callback path is `/api/payments/sandbox/callback`. A Daraja notification is not posted to the ledger. Transaction Status has a separate disabled result path, `/api/payments/sandbox/transaction-status/result`, and a timeout path, `/api/payments/sandbox/transaction-status/timeout`.
- Password reset and email confirmation screens. No email is sent unless Supabase Auth is configured.
- Role checks for recipient, donor, corporate partner, and administrator dashboards, including a workspace chooser when one account has more than one role.
- PostgreSQL migrations in `db/migrations`. On this machine they have been applied to a local database named `jirani`. Row-level security hides profiles from the application role, and that role cannot read password hashes or grant itself administrator.

## Run the app

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Demonstration accounts, all labelled and not real people:

| Role | Email | Password |
| --- | --- | --- |
| Recipient | recipient@demo.jirani.test | demo-recipient |
| Donor | donor@demo.jirani.test | demo-donor |
| Corporate partner | corporate@demo.jirani.test | demo-corporate |
| Recipient and donor | both@demo.jirani.test | demo-both |
| Administrator | admin@demo.jirani.test | demo-admin |

Copy `.env.example` to `.env.local` when you need to change a setting. The example file contains names only.

| Name | Purpose |
| --- | --- |
| `DEMO_MODE` | Set `true` for local demonstration sign-in. Unset, empty, or any other value leaves it off. Production must set `false`. Demonstration accounts do not work when `NODE_ENV=production`. |
| `SESSION_SECRET` | Required in production, at least 32 characters. Signs the demonstration cookie. |
| `DATABASE_URL` | Postgres connection string for migrations and for local account sign-in. The running app should use the `jirani_app` role, not a superuser. |
| `MOCK_PROVIDER_SECRET` | Required in production, at least 16 characters. Signs simulated payment callbacks. |
| `SANDBOX_PROVIDER` | Leave empty. Set `mock` only for a local signed-callback test. `daraja` stays disabled. A callback URL does not enable it. |
| `SANDBOX_WEBHOOK_SECRET` | At least 16 characters when `SANDBOX_PROVIDER=mock`. Signs sandbox callbacks. |
| `DARAJA_SANDBOX_CONSUMER_KEY` | Safaricom Daraja sandbox key. Not used until a verified client exists. |
| `DARAJA_SANDBOX_CONSUMER_SECRET` | Safaricom Daraja sandbox secret. Server only. |
| `DARAJA_SANDBOX_PASSKEY` | Daraja Lipa Na M-Pesa passkey. Server only. |
| `DARAJA_SANDBOX_SHORTCODE` | Sandbox paybill shortcode. |
| `DARAJA_SANDBOX_CALLBACK_URL` | Public HTTPS URL whose path is `/api/payments/sandbox/callback`. Leave empty until that URL exists. Localhost and placeholders do not enable Daraja. |
| `DARAJA_SANDBOX_INITIATOR` | Daraja initiator name for Transaction Status. Server only. Not used while that query stays disabled. |
| `DARAJA_SANDBOX_SECURITY_CREDENTIAL` | Encrypted initiator credential for Transaction Status. Server only. Not the STK passkey. |
| `DARAJA_SANDBOX_RESULT_URL` | Public HTTPS URL whose path is `/api/payments/sandbox/transaction-status/result`. Leave empty. |
| `DARAJA_SANDBOX_TIMEOUT_URL` | Public HTTPS URL whose path is `/api/payments/sandbox/transaction-status/timeout`. Leave empty. |
| `ACCOUNT_STORE` | Leave empty so passwords stay in Postgres. Set `supabase` only when Supabase Auth should hold passwords. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key. Safe to expose to the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Never prefix it with `NEXT_PUBLIC`. |
| `NEXT_PUBLIC_SITE_URL` | Public origin used in email links, such as `http://localhost:3000`. |

## Use Supabase as the database

Use a new Supabase project as PostgreSQL. Leave `ACCOUNT_STORE` empty, and leave `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` empty. Registration then stores the password hash in `auth_credentials`. A later move to your own server is a database dump plus the private evidence files. Do not copy this laptop’s existing `jirani` database into that project.

1. In Project Settings → Database, copy the direct connection on port 5432. Include `sslmode=require`. The transaction pooler on port 6543 drops the per-request role settings.
2. Run `npm run migrate` with `DATABASE_URL` set to the Supabase `postgres` owner for that command only.
3. In the SQL editor, run `ALTER ROLE jirani_app WITH LOGIN PASSWORD '<a new password stored only on the host>';`
4. Point the running app’s `DATABASE_URL` at `jirani_app` on the same direct connection.
5. Keep `SANDBOX_PROVIDER` and every `DARAJA_SANDBOX_*` name empty.

Set `ACCOUNT_STORE=supabase` only if passwords should live in Supabase Auth. That also needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `http://localhost:3000/auth/confirm` on the Supabase redirect allow list. Those passwords do not move with a database dump. A person would need a new password after leaving Supabase. Sign-up metadata may include `recipient`, `donor`, or `corporate_partner`. A database trigger drops any other requested role, including `administrator`, and stores `donor` instead. The application reads roles from `user_roles` after sign-in.

## Apply the database migrations

`DATABASE_URL` must point at the Postgres database you control. For Supabase this is the connection string from Project Settings → Database.

```bash
npm run migrate
```

The runner applies `db/migrations/*.sql` in order and records them in `schema_migrations`. `0001_init.sql` creates the ledger and the first row-level security policies. `0002_auth_roles.sql` adds corporate partners, profile fields, consent status, private review notes, and the role and audit protections. `0004_request_details.sql` adds request categories, status history, and private evidence rules. `0006_financial_ledger.sql` adds append-only ledger rows and the functions that post simulated gifts. `0007_campaign_statuses.sql` adds the review states, and `0008_campaign_operations.sql` adds campaign publication, reconciliation, and simulated campaign gifts on the same ledger. `0009_campaign_reversal_lock.sql` lets a reversal lock a request gift or a campaign gift without a join. `0010_sandbox_payments.sql` adds sandbox payment attempts. A gift is posted only after verification. `0011_sandbox_payment_reference.sql` qualifies a column that shared a name with a function variable. `0012_daraja_posting_gate.sql` refuses a Daraja sandbox row inside the verification function and in the ledger trigger. The STK query does not provide the amount, and Transaction Status has not been established for an STK receipt, so that provider cannot post a gift. `0013_evidence_review.sql` adds evidence categories, review status, and a private campaign link. It does not post gifts. `0014_account_close.sql` lets the holder close the account: the password, email, phone, and private request files are removed, and gift amounts stay in the ledger. Run the migrations as the database owner, not as `jirani_app`.

On this machine the migrations have been applied to the local database `jirani`. The app connects as `jirani_app`. That role cannot read another applicant's draft, publish its own request, or read password hashes. `0005_audit_execute.sql` lets the app call `jirani.write_audit` for review decisions. The function still checks the signed-in actor.

## Create the first administrator

Do this in the Supabase SQL editor, or as the database owner. Do not do it from the registration form.

1. The person registers and confirms their email, which creates a profile.
2. Copy their user id.
3. Run:

```sql
SELECT jirani.bootstrap_administrator('<user-uuid>');
```

`bootstrap_administrator` is not granted to `anon`, `authenticated`, or the application role. A later administrator assigns the role through `jirani.assign_role`, which rejects a person granting it to themselves.

## Phone numbers

The registration form can check a Kenyan mobile number and store it in sign-up metadata when Supabase is configured. No SMS provider is connected. The result of a phone check is always that no message was sent.

## Staging

The deployment note is `docs/deployment-readiness.md`. The staging checklist is `docs/staging-checklist.md`. A production process checks `DEMO_MODE=false`, a PostgreSQL `DATABASE_URL`, a unique `SESSION_SECRET` of at least 32 characters, a unique `MOCK_PROVIDER_SECRET` of at least 16 characters, and a public `https` `NEXT_PUBLIC_SITE_URL` before it serves traffic. Leave `SANDBOX_PROVIDER` empty. Daraja credentials do not start a payment. Migrations stay on the database owner, and private evidence stays on a persistent disk outside `public/`.

## Checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Still pending

- A call to Safaricom Daraja. The readiness note is `docs/daraja-readiness.md`. The STK request, STK query, and Transaction Status request are implemented for sandbox and covered with mocked responses. The app does not send them. Credentials do not enable sending. The STK query does not return the amount or the receipt. Transaction Status posts its result to a separate URL, and its immediate response is only an acknowledgement. Support for verifying an STK receipt through Transaction Status has not been established, so the ledger gate refuses every Daraja notification. The STK callback path is `/api/payments/sandbox/callback`.
- Live M-Pesa, card payments, withdrawals, stored-value wallets, and automatic payouts. The existing contribution flow remains a labelled simulation.
- Physical donations, collection hubs, and an automated beneficiary draw. Selection in this build is one manual record.
- A real SMS provider for phone verification.
- The demonstration sign-in accounts are not database profiles, so they cannot create a database campaign or post a reversal on the persistent ledger. A registered administrator can.

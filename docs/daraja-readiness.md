# Daraja readiness

This note records what Jirani can and cannot do with Safaricom Daraja. It is not approval to take payments. Sending stays off, and automatic ledger posting stays off.

Labels used below:

- **Verified.** Observed in this repository, or in Safaricom's own PHP SDK (`safaricom/mpesa-php-sdk`).
- **Assumption.** A reasonable reading that this repository does not treat as proof.
- **Unverified.** Not established by a Safaricom sample or by a sandbox call. Jirani has not contacted Safaricom.

## Current components

**Verified.** The sandbox adapter is separate from the labelled simulated gift. `SANDBOX_PROVIDER=mock` can post one ledger gift after a signed server callback. `SANDBOX_PROVIDER=daraja` does not.

Implemented Daraja pieces:

| Piece | Where | Limit |
| --- | --- | --- |
| Configuration | `src/domain/sandbox-config.ts` | Daraja mode is typed `ready: false`. Credentials and a callback URL do not change that. |
| STK Push and STK Query builders | `src/domain/daraja-stk.ts` | `buildDarajaStkPushRequest` always returns `sent: false` and `request: null`. |
| Transaction Status builder | `src/domain/daraja-transaction-status.ts` | `buildDarajaTransactionStatusRequest` always returns `sent: false`. `DARAJA_TRANSACTION_STATUS_STK_SUPPORT` is `unproven`. |
| HTTP helpers | `src/server/daraja-sandbox-client.ts` | Used by tests. Application routes do not import this module. A call does nothing unless the caller passes `sendEnabled: true`. |
| STK callback | `POST /api/payments/sandbox/callback` | Parses a Daraja body and does not call the ledger function. |
| Transaction Status result | `POST /api/payments/sandbox/transaction-status/result` | Acknowledgement and result are both refused by the ledger gate. |
| Transaction Status timeout | `POST /api/payments/sandbox/transaction-status/timeout` | Any JSON object is a timeout. Amount fields in it are ignored. |
| Ledger gate | `src/domain/daraja-ledger-gate.ts` | `decideDarajaLedgerPost` returns `postContribution: false` and `postLedger: false` for every Daraja evidence kind. |
| Database gate | `db/migrations/0012_daraja_posting_gate.sql` | `jirani.apply_sandbox_verification` returns `disabled` for a provider other than `sandbox-mock` before any contribution, refund, or ledger write. `jirani.require_ledger_writer` rejects a verified insert unless the provider is `sandbox-mock` and the row is simulated. |

The dashboard session check matches only `/dashboard/:path*`. These three payment routes are outside that matcher. They still do not post a gift.

**Verified.** Production host `https://api.safaricom.co.ke` is rejected by the sandbox HTTP helper. The only host the helper can call, and only when a test passes `sendEnabled: true`, is `https://sandbox.safaricom.co.ke`.

## Credentials and permissions

Names only. Values stay in server environment variables and must not be copied into source, logs, or this document.

**Verified names in `.env.example`.**

STK and OAuth:

- `DARAJA_SANDBOX_CONSUMER_KEY`
- `DARAJA_SANDBOX_CONSUMER_SECRET`
- `DARAJA_SANDBOX_PASSKEY`
- `DARAJA_SANDBOX_SHORTCODE`
- `DARAJA_SANDBOX_CALLBACK_URL`

Transaction Status, separate from the STK passkey:

- `DARAJA_SANDBOX_INITIATOR`
- `DARAJA_SANDBOX_SECURITY_CREDENTIAL`
- `DARAJA_SANDBOX_RESULT_URL`
- `DARAJA_SANDBOX_TIMEOUT_URL`

**Verified from Safaricom's PHP SDK.** OAuth uses the consumer key and secret. STK Push and STK Query use the shortcode, passkey, and timestamp. Transaction Status uses an initiator and a `SecurityCredential`, plus `CommandID` `TransactionStatusQuery`. The passkey is not that credential.

**Assumption.** A future sandbox test would also need the Daraja app to be allowed to call Lipa Na M-Pesa Online, and a Transaction Status test would need an initiator provisioned for the shortcode. This repository does not record that those products are enabled.

**Unverified.** Which `IdentifierType` applies to an STK receipt. The request builder accepts a caller-supplied numeric type and does not choose one. Production shortcode, production passkey, and go-live approval are not configured and are out of scope.

Filling in these variables does not enable sending. `classifySandboxConfig` still returns `ready: false`. `sandboxCanStart()` is true only for the mock provider. `DARAJA_SANDBOX_SEND_ENABLED` and `DARAJA_TRANSACTION_STATUS_SEND_ENABLED` are `false`.

## Callback paths

**Verified.** These paths already exist. Do not invent replacements.

| Purpose | Path | Request field |
| --- | --- | --- |
| STK callback | `/api/payments/sandbox/callback` | `CallBackURL` |
| Transaction Status result | `/api/payments/sandbox/transaction-status/result` | `ResultURL` |
| Transaction Status timeout | `/api/payments/sandbox/transaction-status/timeout` | `QueueTimeOutURL` |

A public URL is accepted only when it is `https`, has no username, password, query, or hash, and its path is exactly the path in the table. Localhost, loopback, private addresses, link-local addresses, documentation ranges, and placeholder suffixes such as `.test`, `.invalid`, `.local`, and `.example` are rejected. A valid URL still does not enable Daraja.

The mock webhook header `x-jirani-sandbox-signature` is for `SANDBOX_PROVIDER=mock` only. It is not applied to Daraja bodies.

## Public HTTPS deployment

**Verified.** Before any later sandbox call, each URL above would have to be reachable on the public internet at that exact path. The app does not choose a host. Leave `DARAJA_SANDBOX_CALLBACK_URL`, `DARAJA_SANDBOX_RESULT_URL`, and `DARAJA_SANDBOX_TIMEOUT_URL` empty until those URLs exist.

**Assumption, from Safaricom's PHP SDK readme.** Daraja delivers the STK notification to `CallBackURL` and the Transaction Status result to `ResultURL`. When the queue cannot accept more work, it delivers a timeout to `QueueTimeOutURL`. The SDK does not publish the timeout JSON. Jirani therefore treats any JSON object on the timeout path as a timeout and does not read an amount from it.

**Unverified.** Whether Safaricom will deliver to a URL that has not been registered on the Daraja portal. Do not treat a deployed path as registered.

## STK Push and STK Query

**Verified from Safaricom's PHP SDK and the request builders.**

STK Push is `POST https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest`. The body fields are `BusinessShortCode`, `Password`, `Timestamp`, `TransactionType` (`CustomerPayBillOnline`), `Amount`, `PartyA`, `PartyB`, `PhoneNumber`, `CallBackURL`, `AccountReference`, and `TransactionDesc`. `Password` is the base64 of shortcode, passkey, and timestamp. `Amount` is whole shillings. `ResponseCode` `0` means the request was accepted for processing. It does not mean the customer paid. The checkout id in a successful accept response has the `ws_CO_` form.

STK Query is `POST https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query` with `BusinessShortCode`, `Password`, `Timestamp`, and `CheckoutRequestID`. Safaricom's SDK reads `ResponseCode`, `ResponseDescription`, `MerchantRequestID`, `CheckoutRequestID`, `ResultCode`, and `ResultDesc`. It does not read an amount or a receipt. `ResultCode` `0` is a successful outcome for that checkout. Jirani records `establishesAmount: false` on every completed query.

The STK callback shape read by the app is `Body.stkCallback`, with `MerchantRequestID`, `CheckoutRequestID`, `ResultCode`, and optional `CallbackMetadata` items. On success those items can include `Amount` and `MpesaReceiptNumber`. The phone number is discarded. Safaricom's PHP SDK reads this body without a signature check. Jirani treats the body as an untrusted notification.

## Receipt and amount

**Verified.** No implemented call both looks up an STK attempt by `CheckoutRequestID` and returns the amount received. The callback amount is not that proof. A successful STK Query is not that proof. A browser response is not that proof.

Transaction Status is `POST https://sandbox.safaricom.co.ke/mpesa/transactionstatus/v1/query`. **Verified from the SDK:** the request can carry `TransactionID`, and the synchronous response is only an acknowledgement (`OriginatorConversationID`, `ConversationID`, `ResponseCode`, `ResponseDescription`). `ResponseCode` `0` means the query was accepted, not that a payment succeeded. The later result, if it arrives, is posted to `ResultURL`. The SDK's result parser names parameters `ReceiptNo`, `Amount`, `TransactionStatus`, and `CreditPartyName`, but it reads them by list position. Jirani accepts those names only when they are `Key` fields and rejects a positional list, because a shifted list would assign the wrong amount.

**Unverified.** That an STK `MpesaReceiptNumber` can be used as `TransactionID`. That a sandbox or production result for an STK receipt includes `ReceiptNo` and `Amount`. That `CreditPartyName` identifies the expected shortcode. CheckoutRequestID is not a Transaction Status lookup field in the SDK.

If the STK callback never arrives, there is no receipt to look up. The payment stays pending. Jirani does not invent a receipt or an amount.

## Evidence required before automatic posting

Automatic posting is not the next implementation step. It would need all of the following, in order, and then a separate approval:

1. Safaricom's own sample, or an authorized sandbox call, showing a Transaction Status result for an STK receipt that includes `ReceiptNo` and `Amount` for the expected shortcode.
2. Parser tests against that sample. Positional parameters stay rejected.
3. Tests that a missing receipt stays pending, and that a wrong receipt, wrong amount, wrong recipient, duplicate, and conflicting result do not post.
4. A new database migration. `0012` currently refuses `daraja-sandbox` inside `jirani.apply_sandbox_verification` and `jirani.require_ledger_writer`. Posting would require a later migration that allows one post only after an explicit server decision. That migration does not exist.
5. A callback security review: the STK body is unsigned, the result URL is a second public endpoint, and neither body is accepted as proof by itself.
6. A written decision to allow posting. `DARAJA_LEDGER_POSTING_ENABLED` remains `false` until that decision.

## Staged rollout

Each stage ends without enabling the next one.

1. **Local mocked tests.** Keep using the current builders, parsers, and database tests. No network call. The mock sandbox stays the only provider that can post a gift.
2. **Verified API capability.** Obtain a Safaricom field sample for an STK receipt under Transaction Status, or record that no such capability exists. Until that sample exists, the amount question stays unresolved.
3. **Controlled sandbox testing.** Only after a public HTTPS origin is chosen and the three paths above are registered. One authorized sandbox STK, then a status query, with secrets kept on the server. Still no ledger post.
4. **Callback security review.** Compare the live sandbox bodies with the parsers. Confirm the acknowledgement is not treated as payment, the timeout is not treated as payment, and a forged callback cannot post.
5. **Separate approval for production.** Production host, production shortcode, and go-live are a later decision. They are not implied by a successful sandbox test. Automatic payouts, wallets, and treating a donor payment as a beneficiary disbursement stay out of scope.

## Safety check for this note

**Verified in the current tree.** Credentials alone cannot start a provider request or post a gift. No route imports the Daraja HTTP client. The ledger gate and migration `0012` both refuse Daraja writes. This document does not change that behavior.

import { describe, expect, it, vi } from "vitest";

import { handleSandboxCallback } from "@/app/api/payments/sandbox/callback/route";
import { DARAJA_SANDBOX_URLS } from "@/domain/daraja-stk";
import { DARAJA_EVIDENCE_KINDS, DARAJA_LEDGER_POSTING_ENABLED, decideDarajaLedgerPost } from "@/domain/daraja-ledger-gate";
import {
  DARAJA_TRANSACTION_STATUS_FIELDS,
  DARAJA_TRANSACTION_STATUS_RESULT_PATH,
  DARAJA_TRANSACTION_STATUS_SEND_ENABLED,
  DARAJA_TRANSACTION_STATUS_STK_SUPPORT,
  DARAJA_TRANSACTION_STATUS_TIMEOUT_PATH,
  assessDarajaTransactionStatus,
  assembleDarajaTransactionStatusBody,
  buildDarajaTransactionStatusRequest,
  classifyTransactionStatusConfig,
  parseDarajaQueueTimeout,
  parseDarajaTransactionStatusCallback,
  planDarajaTransactionStatusQuery,
  type BoundDarajaPayment,
  type DarajaStatusResult,
} from "@/domain/daraja-transaction-status";
import { classifySandboxConfig } from "@/domain/sandbox-config";
import { requestDarajaTransactionStatus } from "@/server/daraja-sandbox-client";
import { handleTransactionStatusResult, handleTransactionStatusTimeout } from "@/server/daraja-status-handler";

const receipt = "LHG31AA5TX";
const otherReceipt = "MIL31H6SD3";
const originator = "32192-41573885-2";
const conversation = "AG_20191219_00004e48cf7e";
const origin = "https://status.jirani.app";
const resultUrl = `${origin}${DARAJA_TRANSACTION_STATUS_RESULT_PATH}`;
const timeoutUrl = `${origin}${DARAJA_TRANSACTION_STATUS_TIMEOUT_PATH}`;
const credential = "security-credential-test";

const configured = {
  DARAJA_SANDBOX_INITIATOR: "jirani-initiator",
  DARAJA_SANDBOX_SECURITY_CREDENTIAL: credential,
  DARAJA_SANDBOX_SHORTCODE: "174379",
  DARAJA_SANDBOX_RESULT_URL: resultUrl,
  DARAJA_SANDBOX_TIMEOUT_URL: timeoutUrl,
};

function resultPayload(input?: { receipt?: string; amount?: number; credit?: string; resultCode?: number; conversationId?: string; positional?: boolean }) {
  const receiptNo = input?.receipt ?? receipt;
  const parameters = input?.positional
    ? [{ Value: receiptNo }, { Value: input?.amount ?? 100 }, { Value: "174379 - Jirani Sandbox" }]
    : [
        { Key: "ConversationID", Value: input?.conversationId ?? conversation },
        { Key: "Amount", Value: input?.amount ?? 100 },
        { Key: "ReceiptNo", Value: receiptNo },
        { Key: "TransactionStatus", Value: "Completed" },
        { Key: "CreditPartyName", Value: input?.credit ?? "174379 - Jirani Sandbox" },
      ];
  return {
    Result: {
      ResultCode: input?.resultCode ?? 0,
      ResultDesc: "The service request is processed successfully.",
      OriginatorConversationID: originator,
      ConversationID: input?.conversationId ?? conversation,
      TransactionID: receiptNo,
      ResultParameters: { ResultParameter: parameters },
    },
  };
}

function acknowledgement() {
  return {
    OriginatorConversationID: originator,
    ConversationID: conversation,
    ResponseCode: "0",
    ResponseDescription: "Accept the service request successfully.",
  };
}

function pendingPayment(overrides: Partial<BoundDarajaPayment> = {}): BoundDarajaPayment {
  return {
    checkoutRequestId: "ws_CO_191220191020363925",
    untrustedReceipt: receipt,
    giftMinor: 10_000,
    expectedShortcode: "174379",
    status: "pending",
    recordedConversationId: null,
    recordedAmountMinor: null,
    ...overrides,
  };
}

function post(body: unknown) {
  return new Request("https://app.invalid/api/payments/sandbox/transaction-status/result", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("transaction status configuration", () => {
  it("stays disabled when the settings are missing or complete", () => {
    expect(DARAJA_LEDGER_POSTING_ENABLED).toBe(false);
    expect(DARAJA_TRANSACTION_STATUS_SEND_ENABLED).toBe(false);
    expect(DARAJA_TRANSACTION_STATUS_STK_SUPPORT).toBe("unproven");
    expect(DARAJA_SANDBOX_URLS.transactionStatus).toBe("https://sandbox.safaricom.co.ke/mpesa/transactionstatus/v1/query");
    expect(classifyTransactionStatusConfig({}).enabled).toBe(false);
    expect(classifyTransactionStatusConfig({}).missing).toContain("DARAJA_SANDBOX_RESULT_URL");
    expect(classifyTransactionStatusConfig({
      ...configured,
      DARAJA_SANDBOX_RESULT_URL: `http://localhost${DARAJA_TRANSACTION_STATUS_RESULT_PATH}`,
      DARAJA_SANDBOX_TIMEOUT_URL: `${origin}/api/payments/sandbox/callback`,
    }).missing).toEqual(expect.arrayContaining(["DARAJA_SANDBOX_RESULT_URL", "DARAJA_SANDBOX_TIMEOUT_URL"]));
    expect(classifyTransactionStatusConfig(configured)).toEqual({ enabled: false, stkReceiptSupport: "unproven", missing: [] });
    expect(classifySandboxConfig({ SANDBOX_PROVIDER: "daraja", DARAJA_SANDBOX_SHORTCODE: "174379" })).toMatchObject({
      ready: false,
      transactionStatus: "disabled",
    });
    expect(buildDarajaTransactionStatusRequest()).toMatchObject({ sent: false, request: null, reason: "disabled" });
  });

  it("builds the documented request without an amount and does not copy a missing receipt", () => {
    expect(DARAJA_TRANSACTION_STATUS_FIELDS).toContain("ResultURL");
    expect(DARAJA_TRANSACTION_STATUS_FIELDS).toContain("QueueTimeOutURL");
    const assembled = assembleDarajaTransactionStatusBody({
      initiator: "jirani-initiator",
      securityCredential: credential,
      transactionId: receipt,
      partyA: "174379",
      identifierType: "4",
      resultUrl,
      timeoutUrl,
      remarks: "Sandbox status",
    });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    expect(assembled.sent).toBe(false);
    expect(assembled.body.CommandID).toBe("TransactionStatusQuery");
    expect(assembled.body.ResultURL).toBe(resultUrl);
    expect(assembled.body.QueueTimeOutURL).toBe(timeoutUrl);
    expect(assembled.body).not.toHaveProperty("Amount");
    expect(assembleDarajaTransactionStatusBody({
      initiator: "jirani-initiator",
      securityCredential: credential,
      transactionId: receipt,
      partyA: "174379",
      identifierType: "4",
      resultUrl: `${origin}/api/payments/sandbox/callback`,
      timeoutUrl,
      remarks: "Sandbox status",
    }).ok).toBe(false);
    expect(planDarajaTransactionStatusQuery(null)).toEqual({ send: false, provesPayment: false, transactionId: null, reason: "missing-receipt" });
    expect(planDarajaTransactionStatusQuery(receipt)).toEqual({ send: false, provesPayment: false, transactionId: null, reason: "disabled" });
  });
});

describe("transaction status parsing", () => {
  it("treats the acknowledgement as acknowledgement only", () => {
    const parsed = parseDarajaTransactionStatusCallback(acknowledgement());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.message).toMatchObject({ kind: "acknowledgement", responseCode: "0", provesPayment: false });
  });

  it("reads a keyed result and rejects a positional or incomplete result", () => {
    const parsed = parseDarajaTransactionStatusCallback(resultPayload());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.message.kind !== "result") throw new Error("expected a result");
    expect(parsed.message).toMatchObject({
      receiptNo: receipt,
      amountMinor: 10_000,
      creditPartyName: "174379 - Jirani Sandbox",
      establishesAmount: false,
      provesPayment: false,
    });
    expect(parseDarajaTransactionStatusCallback(resultPayload({ positional: true })).ok).toBe(false);
    expect(parseDarajaTransactionStatusCallback({ Result: { ResultCode: 0 } }).ok).toBe(false);
    expect(parseDarajaTransactionStatusCallback({ ...acknowledgement(), Result: resultPayload().Result }).ok).toBe(false);
    expect(parseDarajaQueueTimeout(null).ok).toBe(false);
    const timeout = parseDarajaQueueTimeout({ Result: { ResultDesc: "The service request has timed out", Amount: 100 } });
    expect(timeout).toEqual({ ok: true, kind: "timeout", postsLedger: false });
  });
});

describe("transaction status assessment", () => {
  function parsedResult(input?: Parameters<typeof resultPayload>[0]): DarajaStatusResult {
    const parsed = parseDarajaTransactionStatusCallback(resultPayload(input));
    if (!parsed.ok || parsed.message.kind !== "result") throw new Error("expected a result");
    return parsed.message;
  }

  it("keeps a missing receipt pending and does not post a matching result", () => {
    const result = parsedResult();
    expect(assessDarajaTransactionStatus({ result, stored: pendingPayment({ untrustedReceipt: null }) })).toMatchObject({
      result: "pending",
      postsLedger: false,
    });
    const matched = assessDarajaTransactionStatus({ result, stored: pendingPayment() });
    expect(matched).toMatchObject({ result: "pending", postsLedger: false });
    expect(matched.reason).toContain("unproven");
    expect(assessDarajaTransactionStatus({ result, stored: null })).toMatchObject({ result: "unknown", postsLedger: false });
  });

  it("rejects the wrong receipt, amount, recipient, duplicate, and conflict", () => {
    const stored = pendingPayment();
    expect(assessDarajaTransactionStatus({ result: parsedResult({ receipt: otherReceipt }), stored })).toMatchObject({ result: "mismatch", postsLedger: false });
    expect(assessDarajaTransactionStatus({ result: parsedResult({ amount: 200 }), stored })).toMatchObject({ result: "mismatch", postsLedger: false });
    expect(assessDarajaTransactionStatus({ result: parsedResult({ credit: "600000 - Other Shop" }), stored })).toMatchObject({
      result: "wrong-recipient",
      postsLedger: false,
    });
    expect(assessDarajaTransactionStatus({ result: parsedResult(), stored: pendingPayment({ status: "successful" }) })).toMatchObject({
      result: "duplicate",
      postsLedger: false,
    });
    expect(assessDarajaTransactionStatus({
      result: parsedResult({ conversationId: "AG_20191219_00004e48cf7f" }),
      stored: pendingPayment({ recordedConversationId: conversation }),
    })).toMatchObject({ result: "conflict", postsLedger: false });
    expect(assessDarajaTransactionStatus({ result: parsedResult({ resultCode: 1 }), stored })).toMatchObject({ result: "unsuccessful", postsLedger: false });
    expect(assessDarajaTransactionStatus({ result: parsedResult(), stored }).postsLedger).toBe(false);
  });

  it("does not post a successful result whose receipt, amount, and recipient all match", () => {
    for (const evidence of DARAJA_EVIDENCE_KINDS) {
      expect(decideDarajaLedgerPost(evidence)).toMatchObject({
        evidence,
        postContribution: false,
        postLedger: false,
        reason: "daraja-posting-disabled",
      });
    }
    const matched = assessDarajaTransactionStatus({ result: parsedResult(), stored: pendingPayment() });
    expect(matched.result).toBe("pending");
    expect(matched.postsLedger).toBe(false);
    expect(matched.postsLedger).toBe(decideDarajaLedgerPost("transaction-status-result").postLedger);
  });
});

describe("transaction status handlers", () => {
  it("does not post from a disabled result route", async () => {
    const lookup = vi.fn(async () => pendingPayment());
    const response = await handleTransactionStatusResult(post(resultPayload()), configured, { lookup });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ result: "pending", provesPayment: false });
    expect(lookup).toHaveBeenCalledWith(receipt);
    const disabled = await handleTransactionStatusResult(post(resultPayload()), {});
    expect(disabled.status).toBe(503);
    await expect(disabled.json()).resolves.toMatchObject({ error: "Daraja transaction status is disabled. Nothing was posted.", result: "unknown" });
  });

  it("reports mismatch, wrong recipient, duplicate, and a missing stored receipt without posting", async () => {
    const mismatch = await handleTransactionStatusResult(post(resultPayload({ amount: 200 })), configured, { lookup: async () => pendingPayment() });
    await expect(mismatch.json()).resolves.toMatchObject({ result: "mismatch", provesPayment: false });
    const recipient = await handleTransactionStatusResult(post(resultPayload({ credit: "600000 - Other Shop" })), configured, {
      lookup: async () => pendingPayment(),
    });
    await expect(recipient.json()).resolves.toMatchObject({ result: "wrong-recipient", provesPayment: false });
    const duplicate = await handleTransactionStatusResult(post(resultPayload()), configured, {
      lookup: async () => pendingPayment({ status: "successful" }),
    });
    await expect(duplicate.json()).resolves.toMatchObject({ result: "duplicate", provesPayment: false });
    const missing = await handleTransactionStatusResult(post(resultPayload()), configured, {
      lookup: async () => pendingPayment({ untrustedReceipt: null }),
    });
    await expect(missing.json()).resolves.toMatchObject({ result: "pending", provesPayment: false });
    expect(mismatch.status).toBe(503);
    expect(recipient.status).toBe(503);
    expect(duplicate.status).toBe(503);
    expect(missing.status).toBe(503);
  });

  it("rejects a malformed result, ignores an acknowledgement, and keeps a timeout pending", async () => {
    const lookup = vi.fn(async () => pendingPayment());
    const malformed = await handleTransactionStatusResult(post(resultPayload({ positional: true })), configured, { lookup });
    expect(malformed.status).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
    const ack = await handleTransactionStatusResult(post(acknowledgement()), configured, { lookup });
    expect(ack.status).toBe(503);
    await expect(ack.json()).resolves.toMatchObject({ result: "pending", provesPayment: false });
    expect(lookup).not.toHaveBeenCalled();
    const timeout = await handleTransactionStatusTimeout(
      new Request("https://app.invalid/api/payments/sandbox/transaction-status/timeout", {
        method: "POST",
        body: JSON.stringify(resultPayload()),
      }),
      configured,
    );
    expect(timeout.status).toBe(503);
    const timeoutBody = await timeout.json();
    expect(timeoutBody).toMatchObject({ result: "pending", provesPayment: false });
    expect(JSON.stringify(timeoutBody)).not.toContain(receipt);
    const badTimeout = await handleTransactionStatusTimeout(
      new Request("https://app.invalid/api/payments/sandbox/transaction-status/timeout", { method: "POST", body: "[]" }),
      {},
    );
    expect(badTimeout.status).toBe(400);
  });

  it("does not let a transaction status body through the STK callback", async () => {
    const apply = vi.fn();
    const response = await handleSandboxCallback(post(resultPayload()), { SANDBOX_PROVIDER: "daraja" }, { apply, lookup: async () => null });
    expect(response.status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("transaction status request transport", () => {
  it("does not call Safaricom unless a test explicitly enables the mock", async () => {
    const fetchImpl = vi.fn();
    const base = {
      consumerKey: "consumer-key",
      consumerSecret: "oauth-secret-value",
      initiator: "jirani-initiator",
      securityCredential: credential,
      transactionId: receipt,
      partyA: "174379",
      identifierType: "4",
      resultUrl,
      timeoutUrl,
      remarks: "Sandbox status",
      fetchImpl,
    };
    expect(await requestDarajaTransactionStatus(base)).toMatchObject({ sent: false, provesPayment: false, reason: "disabled" });
    expect(await requestDarajaTransactionStatus({ ...base, sendEnabled: true, resultUrl: `${origin}/api/payments/sandbox/callback` })).toMatchObject({
      sent: false,
      reason: "missing-result-url",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a mocked acknowledgement as unpaid and does not echo the credential", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === DARAJA_SANDBOX_URLS.oauth) {
        return new Response(JSON.stringify({ access_token: "tok-test-1234", expires_in: 3599 }), { status: 200 });
      }
      return new Response(JSON.stringify(acknowledgement()), { status: 200 });
    });
    const result = await requestDarajaTransactionStatus({
      consumerKey: "consumer-key",
      consumerSecret: "oauth-secret-value",
      initiator: "jirani-initiator",
      securityCredential: credential,
      transactionId: receipt,
      partyA: "174379",
      identifierType: "4",
      resultUrl,
      timeoutUrl,
      remarks: "Sandbox status",
      fetchImpl,
      sendEnabled: true,
    });
    expect(result).toEqual({ ok: true, sent: true, provesPayment: false, responseCode: "0" });
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(fetchImpl).toHaveBeenCalledWith(DARAJA_SANDBOX_URLS.transactionStatus, expect.objectContaining({ method: "POST" }));
    const resultShaped = await requestDarajaTransactionStatus({
      consumerKey: "consumer-key",
      consumerSecret: "oauth-secret-value",
      initiator: "jirani-initiator",
      securityCredential: credential,
      transactionId: receipt,
      partyA: "174379",
      identifierType: "4",
      resultUrl,
      timeoutUrl,
      remarks: "Sandbox status",
      fetchImpl: vi.fn(async (url: string) => {
        if (url === DARAJA_SANDBOX_URLS.oauth) {
          return new Response(JSON.stringify({ access_token: "tok-test-1234", expires_in: 3599 }), { status: 200 });
        }
        return new Response(JSON.stringify(resultPayload()), { status: 200 });
      }),
      sendEnabled: true,
    });
    expect(resultShaped).toEqual({ ok: false, sent: false, provesPayment: false, reason: "malformed" });
  });
});

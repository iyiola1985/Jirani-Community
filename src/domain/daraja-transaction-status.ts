import { decideDarajaLedgerPost } from "@/domain/daraja-ledger-gate";
import { DARAJA_SANDBOX_URLS, acceptsPublicDarajaHttpsUrl } from "@/domain/daraja-stk";

/** ResultURL path. This is not the STK callback. */
export const DARAJA_TRANSACTION_STATUS_RESULT_PATH = "/api/payments/sandbox/transaction-status/result";

/** QueueTimeOutURL path. This is not the STK callback. */
export const DARAJA_TRANSACTION_STATUS_TIMEOUT_PATH = "/api/payments/sandbox/transaction-status/timeout";

/**
 * Safaricom's PHP SDK names CommandID TransactionStatusQuery for
 * POST /mpesa/transactionstatus/v1/query. The app does not send that request.
 */
export const DARAJA_TRANSACTION_STATUS_FIELDS = [
  "Initiator",
  "SecurityCredential",
  "CommandID",
  "TransactionID",
  "PartyA",
  "IdentifierType",
  "ResultURL",
  "QueueTimeOutURL",
  "Remarks",
  "Occasion",
] as const;

/** Sending stays off. A complete configuration does not flip this. */
export const DARAJA_TRANSACTION_STATUS_SEND_ENABLED = false;

/**
 * No sandbox call has shown that an STK receipt can be queried here, or that
 * the result's Amount is the amount received for that STK attempt.
 * The STK Query response does not include the amount. Automatic posting stays off.
 */
export const DARAJA_TRANSACTION_STATUS_STK_SUPPORT = "unproven" as const;

const RECEIPT = /^[A-Z0-9]{8,20}$/;
const CONVERSATION = /^[A-Za-z0-9_-]{8,64}$/;
const REQUIRED_PARAMETER_KEYS = ["ReceiptNo", "Amount", "TransactionStatus", "CreditPartyName"] as const;

export type DarajaTransactionStatusRequest = {
  Initiator: string;
  SecurityCredential: string;
  CommandID: "TransactionStatusQuery";
  TransactionID: string;
  PartyA: string;
  IdentifierType: string;
  ResultURL: string;
  QueueTimeOutURL: string;
  Remarks: string;
  Occasion?: string;
};

export type TransactionStatusEnv = Partial<
  Record<
    | "DARAJA_SANDBOX_INITIATOR"
    | "DARAJA_SANDBOX_SECURITY_CREDENTIAL"
    | "DARAJA_SANDBOX_RESULT_URL"
    | "DARAJA_SANDBOX_TIMEOUT_URL"
    | "DARAJA_SANDBOX_SHORTCODE",
    string | undefined
  >
>;

export type TransactionStatusConfig = {
  enabled: false;
  stkReceiptSupport: typeof DARAJA_TRANSACTION_STATUS_STK_SUPPORT;
  missing: readonly string[];
};

/**
 * Transaction Status stays disabled. Missing initiator material and result
 * URLs are reported, and a complete set still does not enable sending or posting.
 */
export function classifyTransactionStatusConfig(env: TransactionStatusEnv): TransactionStatusConfig {
  const missing: string[] = [];
  if (!present(env.DARAJA_SANDBOX_INITIATOR)) missing.push("DARAJA_SANDBOX_INITIATOR");
  if (!present(env.DARAJA_SANDBOX_SECURITY_CREDENTIAL)) missing.push("DARAJA_SANDBOX_SECURITY_CREDENTIAL");
  const shortcode = env.DARAJA_SANDBOX_SHORTCODE?.trim() ?? "";
  if (!/^[0-9]{5,7}$/.test(shortcode)) missing.push("DARAJA_SANDBOX_SHORTCODE");
  if (!acceptsPublicDarajaHttpsUrl(env.DARAJA_SANDBOX_RESULT_URL, DARAJA_TRANSACTION_STATUS_RESULT_PATH)) {
    missing.push("DARAJA_SANDBOX_RESULT_URL");
  }
  if (!acceptsPublicDarajaHttpsUrl(env.DARAJA_SANDBOX_TIMEOUT_URL, DARAJA_TRANSACTION_STATUS_TIMEOUT_PATH)) {
    missing.push("DARAJA_SANDBOX_TIMEOUT_URL");
  }
  return { enabled: false, stkReceiptSupport: DARAJA_TRANSACTION_STATUS_STK_SUPPORT, missing };
}

/**
 * Local request body. Occasion is optional in the Safaricom SDK.
 * IdentifierType is passed through; which value applies to an STK receipt is not established.
 * The body is not sent.
 */
export function assembleDarajaTransactionStatusBody(input: {
  initiator: string;
  securityCredential: string;
  transactionId: string;
  partyA: string;
  identifierType: string;
  resultUrl: string;
  timeoutUrl: string;
  remarks: string;
  occasion?: string;
}): { ok: true; sent: false; body: DarajaTransactionStatusRequest } | { ok: false; sent: false; reason: "invalid-request" | "missing-result-url" } {
  if (
    !acceptsPublicDarajaHttpsUrl(input.resultUrl, DARAJA_TRANSACTION_STATUS_RESULT_PATH) ||
    !acceptsPublicDarajaHttpsUrl(input.timeoutUrl, DARAJA_TRANSACTION_STATUS_TIMEOUT_PATH)
  ) {
    return { ok: false, sent: false, reason: "missing-result-url" };
  }
  const initiator = input.initiator.trim();
  const remarks = input.remarks.trim();
  const occasion = input.occasion?.trim() ?? "";
  if (!/^[A-Za-z0-9_. -]{1,64}$/.test(initiator)) return { ok: false, sent: false, reason: "invalid-request" };
  if (input.securityCredential.trim().length < 16 || /[\r\n]/.test(input.securityCredential)) {
    return { ok: false, sent: false, reason: "invalid-request" };
  }
  if (!RECEIPT.test(input.transactionId)) return { ok: false, sent: false, reason: "invalid-request" };
  if (!/^[0-9]{5,12}$/.test(input.partyA) || !/^[0-9]{1,2}$/.test(input.identifierType)) {
    return { ok: false, sent: false, reason: "invalid-request" };
  }
  if (remarks.length < 1 || remarks.length > 100) return { ok: false, sent: false, reason: "invalid-request" };
  if (occasion.length > 100) return { ok: false, sent: false, reason: "invalid-request" };
  return {
    ok: true,
    sent: false,
    body: {
      Initiator: initiator,
      SecurityCredential: input.securityCredential,
      CommandID: "TransactionStatusQuery",
      TransactionID: input.transactionId,
      PartyA: input.partyA,
      IdentifierType: input.identifierType,
      ResultURL: input.resultUrl,
      QueueTimeOutURL: input.timeoutUrl,
      Remarks: remarks,
      ...(occasion ? { Occasion: occasion } : {}),
    },
  };
}

/** The app builder never returns a request. Tests that need a body call the assembler directly. */
export function buildDarajaTransactionStatusRequest(): {
  sent: false;
  url: typeof DARAJA_SANDBOX_URLS.transactionStatus;
  request: null;
  reason: "disabled";
} {
  return {
    sent: DARAJA_TRANSACTION_STATUS_SEND_ENABLED,
    url: DARAJA_SANDBOX_URLS.transactionStatus,
    request: null,
    reason: "disabled",
  };
}

/**
 * No receipt means no TransactionID. The untrusted callback receipt is not copied
 * into a query, and no receipt is invented.
 */
export function planDarajaTransactionStatusQuery(receiptFromCallback: string | null): {
  send: false;
  provesPayment: false;
  transactionId: null;
  reason: "missing-receipt" | "disabled";
} {
  if (!receiptFromCallback || !RECEIPT.test(receiptFromCallback)) {
    return { send: false, provesPayment: false, transactionId: null, reason: "missing-receipt" };
  }
  return { send: false, provesPayment: false, transactionId: null, reason: "disabled" };
}

export type DarajaStatusAcknowledgement = {
  kind: "acknowledgement";
  provesPayment: false;
  originatorConversationId: string;
  conversationId: string;
  responseCode: string;
};

export type DarajaStatusResult = {
  kind: "result";
  provesPayment: false;
  establishesAmount: false;
  resultCode: number;
  transactionId: string;
  receiptNo: string;
  amountMinor: number;
  transactionStatus: string;
  creditPartyName: string;
  conversationId: string;
  originatorConversationId: string;
};

/**
 * Reads either the synchronous acknowledgement or the asynchronous Result.
 * Parameter values are matched by Key. The SDK's positional order is not used,
 * because a shifted list would assign the wrong amount.
 */
export function parseDarajaTransactionStatusCallback(
  payload: unknown,
): { ok: true; message: DarajaStatusAcknowledgement | DarajaStatusResult } | { ok: false; reason: "malformed" } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "malformed" };
  const record = payload as Record<string, unknown>;
  const hasAck = "ResponseCode" in record;
  const hasResult = "Result" in record;
  if (hasAck === hasResult) return { ok: false, reason: "malformed" };
  if (hasAck) {
    const acknowledgement = readAcknowledgement(record);
    return acknowledgement ? { ok: true, message: acknowledgement } : { ok: false, reason: "malformed" };
  }
  const result = readResult(record.Result);
  return result ? { ok: true, message: result } : { ok: false, reason: "malformed" };
}

/**
 * QueueTimeOutURL's body is not specified by the Safaricom SDK. Any JSON object
 * on that route is a timeout. Amount and receipt fields in it are ignored.
 */
export function parseDarajaQueueTimeout(
  payload: unknown,
): { ok: true; kind: "timeout"; postsLedger: false } | { ok: false; reason: "malformed" } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "malformed" };
  const gate = decideDarajaLedgerPost("transaction-status-timeout");
  return { ok: true, kind: "timeout", postsLedger: gate.postLedger };
}

export type BoundDarajaPayment = {
  checkoutRequestId: string;
  untrustedReceipt: string | null;
  giftMinor: number;
  expectedShortcode: string;
  status: "created" | "pending" | "successful" | "failed" | "cancelled" | "quarantined";
  recordedConversationId: string | null;
  recordedAmountMinor: number | null;
};

export type TransactionStatusAssessment = {
  result: "pending" | "unknown" | "mismatch" | "wrong-recipient" | "duplicate" | "conflict" | "unsuccessful";
  postsLedger: false;
  reason: string;
};

/**
 * Compares a parsed result with the payment the receipt was already bound to.
 * A matching result still does not post: STK support for this API is unproven.
 */
export function assessDarajaTransactionStatus(input: {
  result: DarajaStatusResult;
  stored: BoundDarajaPayment | null;
}): TransactionStatusAssessment {
  if (!input.stored) {
    return refuseStatusPost("unknown", "No pending payment is bound to that receipt. Nothing was posted.");
  }
  if (input.stored.untrustedReceipt === null) {
    return refuseStatusPost("pending", "No receipt number is available. The payment stays pending.");
  }
  if (input.result.receiptNo !== input.stored.untrustedReceipt || input.result.transactionId !== input.result.receiptNo) {
    return refuseStatusPost("mismatch", "The status result receipt does not match the pending payment.");
  }
  if (input.result.amountMinor !== input.stored.giftMinor) {
    return refuseStatusPost("mismatch", "The status result amount does not match the pending payment.");
  }
  if (!creditPartyMatches(input.result.creditPartyName, input.stored.expectedShortcode)) {
    return refuseStatusPost("wrong-recipient", "The status result recipient does not match the expected shortcode.");
  }
  if (input.stored.recordedAmountMinor !== null && input.stored.recordedAmountMinor !== input.result.amountMinor) {
    return refuseStatusPost("conflict", "A different amount was already recorded for this payment.");
  }
  if (input.stored.status === "successful" || (input.stored.recordedConversationId !== null && input.stored.recordedConversationId === input.result.conversationId)) {
    return refuseStatusPost("duplicate", "This status result was already recorded. No second gift was posted.");
  }
  if (input.stored.recordedConversationId !== null) {
    return refuseStatusPost("conflict", "A different status result was already recorded for this payment.");
  }
  if (input.result.resultCode !== 0) {
    return refuseStatusPost("unsuccessful", "The transaction status result did not report success. Nothing was posted.");
  }
  return refuseStatusPost("pending", "Transaction Status support for an STK receipt is unproven. Nothing was posted.");
}

function refuseStatusPost(result: TransactionStatusAssessment["result"], reason: string): TransactionStatusAssessment {
  const acknowledgement = decideDarajaLedgerPost("transaction-status-acknowledgement");
  const statusResult = decideDarajaLedgerPost("transaction-status-result");
  return { result, postsLedger: acknowledgement.postLedger || statusResult.postLedger, reason };
}

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function readAcknowledgement(record: Record<string, unknown>): DarajaStatusAcknowledgement | null {
  const originatorConversationId = typeof record.OriginatorConversationID === "string" ? record.OriginatorConversationID : "";
  const conversationId = typeof record.ConversationID === "string" ? record.ConversationID : "";
  const responseCode = typeof record.ResponseCode === "number" && Number.isSafeInteger(record.ResponseCode)
    ? String(record.ResponseCode)
    : typeof record.ResponseCode === "string"
      ? record.ResponseCode
      : "";
  if (!CONVERSATION.test(originatorConversationId) || !CONVERSATION.test(conversationId)) return null;
  if (!/^[0-9]{1,6}$/.test(responseCode)) return null;
  if (typeof record.ResponseDescription !== "string" || record.ResponseDescription.trim().length < 1) return null;
  return {
    kind: "acknowledgement",
    provesPayment: false,
    originatorConversationId,
    conversationId,
    responseCode,
  };
}

function readResult(value: unknown): DarajaStatusResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const resultCode = readResultCode(result.ResultCode);
  const transactionId = typeof result.TransactionID === "string" ? result.TransactionID : "";
  const conversationId = typeof result.ConversationID === "string" ? result.ConversationID : "";
  const originatorConversationId = typeof result.OriginatorConversationID === "string" ? result.OriginatorConversationID : "";
  if (resultCode === null || !RECEIPT.test(transactionId)) return null;
  if (!CONVERSATION.test(conversationId) || !CONVERSATION.test(originatorConversationId)) return null;
  if (typeof result.ResultDesc !== "string") return null;
  const parameters = readParametersByKey(result.ResultParameters);
  if (!parameters) return null;
  const receiptNo = parameters.ReceiptNo;
  const transactionStatus = parameters.TransactionStatus;
  const creditPartyName = parameters.CreditPartyName;
  const amountMinor = shillingsToMinor(parameters.Amount);
  if (typeof receiptNo !== "string" || !RECEIPT.test(receiptNo) || receiptNo !== transactionId) return null;
  if (typeof transactionStatus !== "string" || transactionStatus.trim().length < 1 || transactionStatus.length > 64) return null;
  if (typeof creditPartyName !== "string" || creditPartyName.trim().length < 1 || creditPartyName.length > 128) return null;
  if (amountMinor === null) return null;
  return {
    kind: "result",
    provesPayment: false,
    establishesAmount: false,
    resultCode,
    transactionId,
    receiptNo,
    amountMinor,
    transactionStatus: transactionStatus.trim(),
    creditPartyName: creditPartyName.trim(),
    conversationId,
    originatorConversationId,
  };
}

function readParametersByKey(value: unknown): Record<(typeof REQUIRED_PARAMETER_KEYS)[number], unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as { ResultParameter?: unknown }).ResultParameter;
  const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : null;
  if (!items) return null;
  const found = new Map<string, unknown>();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const key = (item as { Key?: unknown }).Key;
    if (typeof key !== "string" || !key.trim()) return null;
    if (found.has(key)) return null;
    found.set(key, (item as { Value?: unknown }).Value);
  }
  for (const key of REQUIRED_PARAMETER_KEYS) {
    if (!found.has(key)) return null;
  }
  return {
    ReceiptNo: found.get("ReceiptNo"),
    Amount: found.get("Amount"),
    TransactionStatus: found.get("TransactionStatus"),
    CreditPartyName: found.get("CreditPartyName"),
  };
}

function readResultCode(value: unknown): number | null {
  const code = typeof value === "number" ? value : typeof value === "string" && /^[0-9]{1,6}$/.test(value) ? Number(value) : null;
  if (code === null || !Number.isSafeInteger(code)) return null;
  return code;
}

function shillingsToMinor(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^[0-9]+(\.[0-9]{1,2})?$/.test(value) ? Number(value) : null;
  if (numeric === null || !Number.isFinite(numeric) || numeric <= 0) return null;
  const minor = Math.round(numeric * 100);
  if (!Number.isSafeInteger(minor) || Math.abs(numeric * 100 - minor) > 0.001) return null;
  return minor;
}

function creditPartyMatches(name: string, shortcode: string): boolean {
  if (!/^[0-9]{5,7}$/.test(shortcode)) return false;
  return name.split(/[^A-Za-z0-9]+/).filter((token) => token.length > 0).includes(shortcode);
}

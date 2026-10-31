import { decideDarajaLedgerPost } from "@/domain/daraja-ledger-gate";
import { DARAJA_CALLBACK_PATH } from "@/domain/daraja-stk";

export type DarajaCallbackNotice = {
  merchantRequestId: string;
  checkoutRequestId: string;
  reportedResultCode: number;
  amountMinor: number | null;
};

export type StoredDarajaAttempt = {
  checkoutRequestId: string;
  giftMinor: number;
  status: string;
};

/**
 * Documented STK Push Query fields are ResponseCode, ResponseDescription,
 * MerchantRequestID, CheckoutRequestID, ResultCode, and ResultDesc.
 * That response does not include Amount or MpesaReceiptNumber, so it cannot
 * prove the amount paid. Transaction Status support for an STK receipt has
 * not been established. Both notifications stop at the Daraja ledger gate.
 */
export type DarajaQueryEvidence =
  | { state: "not-run" }
  | { state: "timeout" | "rejected" | "malformed" }
  | { state: "completed"; checkoutRequestId: string; resultCode: number; establishesAmount: false };

export type DarajaAssessment = {
  result: "pending" | "unknown" | "mismatch" | "duplicate" | "unsuccessful";
  postsLedger: false;
  reason: string;
};

const CHECKOUT_ID = /^ws_CO_[A-Za-z0-9_]{6,57}$/;
const MERCHANT_ID = /^[A-Za-z0-9-]{8,40}$/;

/**
 * Reads a Lipa Na M-Pesa Online callback.
 * The body is a notification, not proof of payment. Phone numbers are ignored.
 */
export function parseDarajaStkCallback(
  payload: unknown,
): { ok: true; notice: DarajaCallbackNotice } | { ok: false; reason: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "The callback payload is not a Daraja notification." };
  }
  const body = (payload as { Body?: unknown }).Body;
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "The callback payload is not a Daraja notification." };
  }
  const callback = (body as { stkCallback?: unknown }).stkCallback;
  if (!callback || typeof callback !== "object") {
    return { ok: false, reason: "The callback payload is not a Daraja notification." };
  }
  const record = callback as Record<string, unknown>;
  const merchantRequestId = typeof record.MerchantRequestID === "string" ? record.MerchantRequestID : "";
  const checkoutRequestId = typeof record.CheckoutRequestID === "string" ? record.CheckoutRequestID : "";
  const reportedResultCode = readResultCode(record.ResultCode);
  if (!MERCHANT_ID.test(merchantRequestId) || !CHECKOUT_ID.test(checkoutRequestId) || reportedResultCode === null) {
    return { ok: false, reason: "The callback payload is not a Daraja notification." };
  }
  const amount = readAmount(record.CallbackMetadata);
  if (amount === "invalid") {
    return { ok: false, reason: "The callback payload is not a Daraja notification." };
  }
  return {
    ok: true,
    notice: { merchantRequestId, checkoutRequestId, reportedResultCode, amountMinor: amount },
  };
}

/**
 * A Daraja callback cannot post a gift. The status query identifies the checkout
 * and a result code, but it does not return the amount, so verification stays incomplete.
 */
export function assessDarajaSettlement(input: {
  notice: DarajaCallbackNotice;
  stored: StoredDarajaAttempt | null;
  query?: DarajaQueryEvidence;
}): DarajaAssessment {
  const query = input.query ?? { state: "not-run" };
  if (!input.stored || input.stored.checkoutRequestId !== input.notice.checkoutRequestId) {
    return refuseDarajaPost("unknown", "No pending payment matches that checkout request.");
  }
  if (query.state === "completed" && query.checkoutRequestId !== input.stored.checkoutRequestId) {
    return refuseDarajaPost("unknown", "The status query checkout does not match the pending payment.");
  }
  if (input.notice.amountMinor !== null && input.notice.amountMinor !== input.stored.giftMinor) {
    return refuseDarajaPost("mismatch", "The callback amount does not match the pending payment.");
  }
  if (input.notice.reportedResultCode === 0 && input.notice.amountMinor === null) {
    return refuseDarajaPost("mismatch", "The callback did not include a matching amount.");
  }
  if (input.stored.status === "successful") {
    return refuseDarajaPost("duplicate", "This checkout was already recorded. No second gift was posted.");
  }
  if (query.state === "timeout" || query.state === "rejected" || query.state === "malformed") {
    return refuseDarajaPost("pending", "The STK status query did not complete. Nothing was posted.");
  }
  if (query.state === "completed" && query.resultCode !== 0) {
    return refuseDarajaPost("unsuccessful", "The STK status query did not report success. Nothing was posted.");
  }
  if (query.state === "completed" && query.resultCode === 0 && !query.establishesAmount) {
    return refuseDarajaPost("pending", "The STK status query does not return the amount paid. The payment stays pending.");
  }
  return refuseDarajaPost("pending", "Daraja status verification is incomplete. The payment stays pending and nothing was posted.");
}

function refuseDarajaPost(result: DarajaAssessment["result"], reason: string): DarajaAssessment {
  const callback = decideDarajaLedgerPost("stk-callback");
  const query = decideDarajaLedgerPost("stk-query");
  return { result, postsLedger: callback.postLedger || query.postLedger, reason };
}

export function parseDarajaStkQuery(payload: unknown): DarajaQueryEvidence {
  if (!payload || typeof payload !== "object") return { state: "malformed" };
  const record = payload as Record<string, unknown>;
  if (typeof record.errorCode === "string" || typeof record.errorMessage === "string") return { state: "rejected" };
  if (record.ResponseCode !== "0" && record.ResponseCode !== 0) return { state: "rejected" };
  const checkoutRequestId = typeof record.CheckoutRequestID === "string" ? record.CheckoutRequestID : "";
  const resultCode = readResultCode(record.ResultCode);
  if (!CHECKOUT_ID.test(checkoutRequestId) || resultCode === null) return { state: "malformed" };
  return { state: "completed", checkoutRequestId, resultCode, establishesAmount: false };
}

function readResultCode(value: unknown): number | null {
  const code = typeof value === "number" ? value : typeof value === "string" && /^[0-9]{1,6}$/.test(value) ? Number(value) : null;
  if (code === null || !Number.isSafeInteger(code)) return null;
  return code;
}

function readAmount(metadata: unknown): number | null | "invalid" {
  if (metadata === undefined || metadata === null) return null;
  if (typeof metadata !== "object") return "invalid";
  const items = (metadata as { Item?: unknown }).Item;
  if (!Array.isArray(items)) return "invalid";
  const amount = items.find((item) => item && typeof item === "object" && (item as { Name?: unknown }).Name === "Amount") as
    | { Value?: unknown }
    | undefined;
  if (!amount || amount.Value === undefined) return null;
  return shillingsToMinor(amount.Value);
}

function shillingsToMinor(value: unknown): number | "invalid" {
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^[0-9]+(\.[0-9]{1,2})?$/.test(value) ? Number(value) : null;
  if (numeric === null || !Number.isFinite(numeric) || numeric <= 0) return "invalid";
  const minor = Math.round(numeric * 100);
  if (!Number.isSafeInteger(minor) || Math.abs(numeric * 100 - minor) > 0.001) return "invalid";
  return minor;
}

export { DARAJA_CALLBACK_PATH };

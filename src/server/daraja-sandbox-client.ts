import "server-only";

import {
  DARAJA_SANDBOX_URLS,
  acceptsPublicDarajaCallbackUrl,
  assembleDarajaStkPushBody,
  assembleDarajaStkQueryBody,
  darajaTimestamp,
} from "@/domain/daraja-stk";
import { assembleDarajaTransactionStatusBody, parseDarajaTransactionStatusCallback } from "@/domain/daraja-transaction-status";

const SANDBOX_ORIGIN = "https://sandbox.safaricom.co.ke";

type CallFailure = "timeout" | "unavailable" | "malformed" | "disabled" | "rejected";

export type DarajaCallResult =
  | { ok: true; status: number; payload: unknown }
  | { ok: false; reason: CallFailure };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Sandbox HTTP helper. Sending stays off unless a caller passes sendEnabled.
 * The payment routes do not pass it. Errors omit response bodies and credentials.
 */
export async function executeDarajaSandboxRequest(input: {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  sendEnabled?: boolean;
}): Promise<DarajaCallResult> {
  if (input.sendEnabled !== true) return { ok: false, reason: "disabled" };
  if (!input.url.startsWith(`${SANDBOX_ORIGIN}/`)) return { ok: false, reason: "rejected" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: controller.signal,
    });
    const text = await response.text();
    if (response.status >= 400) return { ok: false, reason: "rejected" };
    try {
      return { ok: true, status: response.status, payload: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, reason: "malformed" };
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestDarajaOauth(input: {
  consumerKey: string;
  consumerSecret: string;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  sendEnabled?: boolean;
}): Promise<{ ok: true; expiresIn: number } | { ok: false; reason: "disabled" | "timeout" | "unavailable" | "malformed" | "oauth-failed" }> {
  const result = await executeDarajaSandboxRequest({
    url: DARAJA_SANDBOX_URLS.oauth,
    method: "GET",
    headers: { Authorization: basic(input.consumerKey, input.consumerSecret) },
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs ?? 15_000,
    sendEnabled: input.sendEnabled,
  });
  if (!result.ok) return mapOauthFailure(result.reason);
  const expiresIn = expiresInFrom(result.payload);
  if (expiresIn === null) return { ok: false, reason: "oauth-failed" };
  return { ok: true, expiresIn };
}

export function interpretStkPushResponse(payload: unknown): { ok: true; paid: false; checkoutRequestId: string; merchantRequestId: string } | { ok: false; paid: false; reason: "rejected" | "malformed" } {
  if (!payload || typeof payload !== "object") return { ok: false, paid: false, reason: "malformed" };
  const record = payload as Record<string, unknown>;
  if (record.ResponseCode !== "0" && record.ResponseCode !== 0) return { ok: false, paid: false, reason: "rejected" };
  const checkoutRequestId = typeof record.CheckoutRequestID === "string" ? record.CheckoutRequestID : "";
  const merchantRequestId = typeof record.MerchantRequestID === "string" ? record.MerchantRequestID : "";
  if (!/^ws_CO_[A-Za-z0-9_]{6,57}$/.test(checkoutRequestId) || merchantRequestId.length < 8) {
    return { ok: false, paid: false, reason: "malformed" };
  }
  return { ok: true, paid: false, checkoutRequestId, merchantRequestId };
}

export async function requestDarajaStkPush(input: {
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  phone: string;
  amountShillings: number;
  callbackUrl: string;
  accountReference: string;
  transactionDesc: string;
  fetchImpl: FetchLike;
  now?: Date;
  timeoutMs?: number;
  sendEnabled?: boolean;
}): Promise<{ ok: false; paid: false; reason: string; sent: false } | { ok: true; paid: false; sent: true; checkoutRequestId: string }> {
  if (input.sendEnabled !== true) return { ok: false, paid: false, reason: "disabled", sent: false };
  if (!acceptsPublicDarajaCallbackUrl(input.callbackUrl)) {
    return { ok: false, paid: false, reason: "missing-callback-url", sent: false };
  }
  const assembled = assembleDarajaStkPushBody({
    shortcode: input.shortcode,
    passkey: input.passkey,
    timestamp: darajaTimestamp(input.now ?? new Date()),
    amountShillings: input.amountShillings,
    phone: input.phone,
    callbackUrl: input.callbackUrl,
    accountReference: input.accountReference,
    transactionDesc: input.transactionDesc,
  });
  if (!assembled.ok) return { ok: false, paid: false, reason: assembled.reason, sent: false };
  const bearer = await bearerToken(input);
  if (!bearer.ok) return { ok: false, paid: false, reason: bearer.reason, sent: false };
  const posted = await executeDarajaSandboxRequest({
    url: DARAJA_SANDBOX_URLS.stkPush,
    method: "POST",
    headers: { Authorization: `Bearer ${bearer.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(assembled.body),
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs ?? 15_000,
    sendEnabled: true,
  });
  if (!posted.ok) return { ok: false, paid: false, reason: posted.reason, sent: false };
  const interpreted = interpretStkPushResponse(posted.payload);
  if (!interpreted.ok) return { ok: false, paid: false, reason: interpreted.reason, sent: false };
  return { ok: true, paid: false, sent: true, checkoutRequestId: interpreted.checkoutRequestId };
}

export async function requestDarajaStkQuery(input: {
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  checkoutRequestId: string;
  fetchImpl: FetchLike;
  now?: Date;
  timeoutMs?: number;
  sendEnabled?: boolean;
}): Promise<{ ok: false; reason: string; sent: false } | { ok: true; sent: true; payload: unknown }> {
  if (input.sendEnabled !== true) return { ok: false, reason: "disabled", sent: false };
  const assembled = assembleDarajaStkQueryBody({
    shortcode: input.shortcode,
    passkey: input.passkey,
    timestamp: darajaTimestamp(input.now ?? new Date()),
    checkoutRequestId: input.checkoutRequestId,
  });
  if (!assembled.ok) return { ok: false, reason: assembled.reason, sent: false };
  const bearer = await bearerToken(input);
  if (!bearer.ok) return { ok: false, reason: bearer.reason, sent: false };
  const posted = await executeDarajaSandboxRequest({
    url: DARAJA_SANDBOX_URLS.stkQuery,
    method: "POST",
    headers: { Authorization: `Bearer ${bearer.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(assembled.body),
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs ?? 15_000,
    sendEnabled: true,
  });
  if (!posted.ok) return { ok: false, reason: posted.reason, sent: false };
  return { ok: true, sent: true, payload: posted.payload };
}

export async function requestDarajaTransactionStatus(input: {
  consumerKey: string;
  consumerSecret: string;
  initiator: string;
  securityCredential: string;
  transactionId: string;
  partyA: string;
  identifierType: string;
  resultUrl: string;
  timeoutUrl: string;
  remarks: string;
  occasion?: string;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  sendEnabled?: boolean;
}): Promise<
  | { ok: false; sent: false; provesPayment: false; reason: string }
  | { ok: true; sent: true; provesPayment: false; responseCode: string }
> {
  if (input.sendEnabled !== true) return { ok: false, sent: false, provesPayment: false, reason: "disabled" };
  const assembled = assembleDarajaTransactionStatusBody(input);
  if (!assembled.ok) return { ok: false, sent: false, provesPayment: false, reason: assembled.reason };
  const bearer = await bearerToken(input);
  if (!bearer.ok) return { ok: false, sent: false, provesPayment: false, reason: bearer.reason };
  const posted = await executeDarajaSandboxRequest({
    url: DARAJA_SANDBOX_URLS.transactionStatus,
    method: "POST",
    headers: { Authorization: `Bearer ${bearer.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(assembled.body),
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs ?? 15_000,
    sendEnabled: true,
  });
  if (!posted.ok) return { ok: false, sent: false, provesPayment: false, reason: posted.reason };
  const parsed = parseDarajaTransactionStatusCallback(posted.payload);
  if (!parsed.ok || parsed.message.kind !== "acknowledgement") {
    return { ok: false, sent: false, provesPayment: false, reason: "malformed" };
  }
  return { ok: true, sent: true, provesPayment: false, responseCode: parsed.message.responseCode };
}

function basic(consumerKey: string, consumerSecret: string): string {
  return `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`;
}

function mapOauthFailure(reason: CallFailure): { ok: false; reason: "timeout" | "unavailable" | "malformed" | "disabled" | "oauth-failed" } {
  switch (reason) {
    case "rejected":
      return { ok: false, reason: "oauth-failed" };
    case "timeout":
    case "unavailable":
    case "malformed":
    case "disabled":
      return { ok: false, reason };
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

function expiresInFrom(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.access_token !== "string" || record.access_token.length < 8) return null;
  const expiresIn = typeof record.expires_in === "number" ? record.expires_in : Number(record.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return expiresIn;
}

async function bearerToken(input: { consumerKey: string; consumerSecret: string; fetchImpl: FetchLike; timeoutMs?: number }): Promise<{ ok: true; token: string } | { ok: false; reason: "timeout" | "unavailable" | "malformed" | "disabled" | "oauth-failed" }> {
  const result = await executeDarajaSandboxRequest({
    url: DARAJA_SANDBOX_URLS.oauth,
    method: "GET",
    headers: { Authorization: basic(input.consumerKey, input.consumerSecret) },
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs ?? 15_000,
    sendEnabled: true,
  });
  if (!result.ok) return mapOauthFailure(result.reason);
  const token = result.payload && typeof result.payload === "object" ? (result.payload as { access_token?: unknown }).access_token : undefined;
  if (typeof token !== "string" || token.length < 8) return { ok: false, reason: "oauth-failed" };
  return { ok: true, token };
}

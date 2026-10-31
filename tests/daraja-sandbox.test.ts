import { describe, expect, it, vi } from "vitest";

import { assessDarajaSettlement, parseDarajaStkCallback, parseDarajaStkQuery } from "@/domain/daraja-callback";
import {
  DARAJA_CALLBACK_PATH,
  DARAJA_SANDBOX_SEND_ENABLED,
  DARAJA_SANDBOX_URLS,
  assembleDarajaStkPushBody,
  assembleDarajaStkQueryBody,
  darajaPassword,
  darajaTimestamp,
} from "@/domain/daraja-stk";
import {
  executeDarajaSandboxRequest,
  interpretStkPushResponse,
  requestDarajaOauth,
  requestDarajaStkPush,
  requestDarajaStkQuery,
} from "@/server/daraja-sandbox-client";

const checkoutRequestId = "ws_CO_191220191020363925";
const callbackUrl = `https://callback.example.net${DARAJA_CALLBACK_PATH}`;
const secret = "oauth-secret-value";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Daraja request construction", () => {
  it("builds an unsent STK body with CallBackURL, timestamp, and password", () => {
    expect(DARAJA_SANDBOX_SEND_ENABLED).toBe(false);
    const timestamp = darajaTimestamp(new Date("2026-10-29T07:31:00.000Z"));
    expect(timestamp).toBe("20261029103100");
    const built = assembleDarajaStkPushBody({
      shortcode: "174379",
      passkey: "test-passkey",
      timestamp,
      amountShillings: 100,
      phone: "254708374149",
      callbackUrl,
      accountReference: "JIRANI",
      transactionDesc: "Sandbox gift",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body.CallBackURL).toBe(callbackUrl);
    expect(built.body.Password).toBe(darajaPassword("174379", "test-passkey", timestamp));
    expect(built.body.Amount).toBe("100");
    expect(built.body.TransactionType).toBe("CustomerPayBillOnline");
    expect(built.body.BusinessShortCode).toBe("174379");
    expect(assembleDarajaStkPushBody({ ...built.body, shortcode: "174379", passkey: "test-passkey", timestamp, amountShillings: 100, phone: "254708374149", callbackUrl: "http://localhost/api/payments/sandbox/callback", accountReference: "JIRANI", transactionDesc: "Sandbox gift" }).ok).toBe(false);
    const query = assembleDarajaStkQueryBody({ shortcode: "174379", passkey: "test-passkey", timestamp, checkoutRequestId });
    expect(query.ok).toBe(true);
  });

  it("does not call Safaricom when sending is off or the callback URL is not public", async () => {
    const fetchImpl = vi.fn();
    const base = {
      consumerKey: "consumer-key",
      consumerSecret: secret,
      shortcode: "174379",
      passkey: "test-passkey",
      phone: "254708374149",
      amountShillings: 100,
      callbackUrl,
      accountReference: "JIRANI",
      transactionDesc: "Sandbox gift",
      fetchImpl,
    };
    expect(await requestDarajaStkPush(base)).toMatchObject({ sent: false, paid: false, reason: "disabled" });
    expect(await requestDarajaStkPush({ ...base, sendEnabled: true })).toMatchObject({ sent: false, reason: "missing-callback-url" });
    expect(await requestDarajaStkQuery({ ...base, checkoutRequestId })).toMatchObject({ sent: false, reason: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Daraja sandbox HTTP failures", () => {
  it("reports an OAuth failure without echoing the secret", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "denied" }, 401));
    const result = await requestDarajaOauth({ consumerKey: "consumer-key", consumerSecret: secret, fetchImpl, sendEnabled: true });
    expect(result).toEqual({ ok: false, reason: "oauth-failed" });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(fetchImpl).toHaveBeenCalledWith(DARAJA_SANDBOX_URLS.oauth, expect.objectContaining({ method: "GET" }));
    const production = await executeDarajaSandboxRequest({
      url: "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      method: "POST",
      headers: {},
      fetchImpl,
      timeoutMs: 1000,
      sendEnabled: true,
    });
    expect(production).toEqual({ ok: false, reason: "rejected" });
  });

  it("reports a provider timeout", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }));
    const result = await requestDarajaOauth({ consumerKey: "consumer-key", consumerSecret: secret, fetchImpl, timeoutMs: 20, sendEnabled: true });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("treats a rejected STK response as unpaid", () => {
    expect(interpretStkPushResponse({ ResponseCode: "1", ResponseDescription: "Rejected" })).toEqual({ ok: false, paid: false, reason: "rejected" });
    expect(interpretStkPushResponse({
      ResponseCode: "0",
      MerchantRequestID: "29115-34620561-1",
      CheckoutRequestID: checkoutRequestId,
    })).toMatchObject({ ok: true, paid: false, checkoutRequestId });
  });

  it("runs a mocked status query and does not treat it as amount proof", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === DARAJA_SANDBOX_URLS.oauth) return jsonResponse({ access_token: "tok-test-1234", expires_in: 3599 });
      return jsonResponse({
        ResponseCode: "0",
        ResponseDescription: "The service request has been accepted successsfully",
        MerchantRequestID: "29115-34620561-1",
        CheckoutRequestID: checkoutRequestId,
        ResultCode: "0",
        ResultDesc: "The service request is processed successfully.",
      });
    });
    const queried = await requestDarajaStkQuery({
      consumerKey: "consumer-key",
      consumerSecret: secret,
      shortcode: "174379",
      passkey: "test-passkey",
      checkoutRequestId,
      fetchImpl,
      sendEnabled: true,
      now: new Date("2026-10-29T07:31:00.000Z"),
    });
    expect(queried.ok).toBe(true);
    if (!queried.ok) return;
    const evidence = parseDarajaStkQuery(queried.payload);
    expect(evidence).toMatchObject({ state: "completed", checkoutRequestId, resultCode: 0, establishesAmount: false });
    expect(JSON.stringify(queried)).not.toContain(secret);
    const notice = parseDarajaStkCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: "29115-34620561-1",
          CheckoutRequestID: checkoutRequestId,
          ResultCode: 0,
          CallbackMetadata: { Item: [{ Name: "Amount", Value: 100 }] },
        },
      },
    });
    if (!notice.ok) throw new Error("expected a callback");
    const stored = { checkoutRequestId, giftMinor: 10_000, status: "pending" };
    expect(assessDarajaSettlement({ notice: notice.notice, stored, query: evidence })).toMatchObject({
      result: "pending",
      postsLedger: false,
    });
    expect(assessDarajaSettlement({ notice: notice.notice, stored: { ...stored, status: "successful" }, query: evidence })).toMatchObject({
      result: "duplicate",
      postsLedger: false,
    });
  });
});

describe("Daraja verification policy", () => {
  const pending = { checkoutRequestId, giftMinor: 10_000, status: "pending" };
  const notice = parseDarajaStkCallback({
    Body: {
      stkCallback: {
        MerchantRequestID: "29115-34620561-1",
        CheckoutRequestID: checkoutRequestId,
        ResultCode: 0,
        CallbackMetadata: { Item: [{ Name: "Amount", Value: 100 }] },
      },
    },
  });
  if (!notice.ok) throw new Error("expected a callback");
  const successQuery = { state: "completed" as const, checkoutRequestId, resultCode: 0, establishesAmount: false as const };

  it("keeps unknown, failed, mismatched, and incomplete results out of the ledger", () => {
    expect(parseDarajaStkQuery({ errorCode: "500.001.1001", errorMessage: "Unable to process" })).toEqual({ state: "rejected" });
    expect(parseDarajaStkQuery(null)).toEqual({ state: "malformed" });
    expect(assessDarajaSettlement({ notice: notice.notice, stored: null, query: successQuery })).toMatchObject({ result: "unknown", postsLedger: false });
    expect(assessDarajaSettlement({ notice: notice.notice, stored: { ...pending, giftMinor: 20_000 }, query: successQuery })).toMatchObject({ result: "mismatch", postsLedger: false });
    expect(assessDarajaSettlement({ notice: notice.notice, stored: pending, query: { state: "timeout" } })).toMatchObject({ result: "pending", postsLedger: false });
    expect(assessDarajaSettlement({ notice: notice.notice, stored: pending, query: { state: "rejected" } })).toMatchObject({ result: "pending", postsLedger: false });
    expect(assessDarajaSettlement({
      notice: notice.notice,
      stored: pending,
      query: { state: "completed", checkoutRequestId, resultCode: 1032, establishesAmount: false },
    })).toMatchObject({ result: "unsuccessful", postsLedger: false });
    const first = assessDarajaSettlement({ notice: notice.notice, stored: pending, query: successQuery });
    const second = assessDarajaSettlement({ notice: notice.notice, stored: pending, query: successQuery });
    expect(first.postsLedger).toBe(false);
    expect(second.postsLedger).toBe(false);
  });
});

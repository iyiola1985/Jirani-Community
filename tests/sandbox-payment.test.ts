import { describe, expect, it, vi } from "vitest";

import { handleSandboxCallback } from "@/app/api/payments/sandbox/callback/route";
import { assessDarajaSettlement, parseDarajaStkCallback } from "@/domain/daraja-callback";
import { DARAJA_CALLBACK_PATH, DARAJA_STK_PUSH_FIELDS, buildDarajaStkPushRequest } from "@/domain/daraja-stk";
import { readSandboxCallback, signSandboxCallback } from "@/domain/sandbox-callback";
import { classifySandboxConfig } from "@/domain/sandbox-config";

const event = {
  providerEventId: "evt_sandbox_001",
  providerReference: "sbx_abc12345",
  reportedStatus: "successful" as const,
  amountMinor: 10_000,
  currency: "KES" as const,
};

describe("sandbox configuration", () => {
  it("stays unconfigured until a provider is chosen", () => {
    expect(classifySandboxConfig({}).mode).toBe("unconfigured");
    expect(classifySandboxConfig({ SANDBOX_PROVIDER: "mock" }).mode).toBe("unconfigured");
    const daraja = classifySandboxConfig({ SANDBOX_PROVIDER: "daraja", DARAJA_SANDBOX_SHORTCODE: "174379" });
    expect(daraja.mode).toBe("daraja");
    if (daraja.mode === "daraja") {
      expect(daraja.ready).toBe(false);
      expect(daraja.missing).toContain("DARAJA_SANDBOX_CONSUMER_KEY");
    }
  });

  it("accepts a mock secret without treating Daraja settings as a live client", () => {
    const mock = classifySandboxConfig({ SANDBOX_PROVIDER: "mock", SANDBOX_WEBHOOK_SECRET: "sandbox-webhook-secret" });
    expect(mock.mode).toBe("mock");
    const ready = classifySandboxConfig({
      SANDBOX_PROVIDER: "daraja",
      DARAJA_SANDBOX_CONSUMER_KEY: "key",
      DARAJA_SANDBOX_CONSUMER_SECRET: "secret",
      DARAJA_SANDBOX_PASSKEY: "passkey",
      DARAJA_SANDBOX_SHORTCODE: "174379",
      DARAJA_SANDBOX_CALLBACK_URL: "https://example.test/callback",
    });
    expect(ready).toMatchObject({ mode: "daraja", ready: false, verification: "incomplete" });
    if (ready.mode === "daraja") expect(ready.missing).toContain("DARAJA_SANDBOX_CALLBACK_URL");
  });

  it("stays disabled when the callback URL is missing, local, or not this route", () => {
    const names = {
      DARAJA_SANDBOX_CONSUMER_KEY: "key",
      DARAJA_SANDBOX_CONSUMER_SECRET: "secret",
      DARAJA_SANDBOX_PASSKEY: "passkey",
      DARAJA_SANDBOX_SHORTCODE: "174379",
    };
    for (const callback of ["", "http://localhost/api/payments/sandbox/callback", `https://127.0.0.1${DARAJA_CALLBACK_PATH}`, "https://callback.example/other"]) {
      const config = classifySandboxConfig({ SANDBOX_PROVIDER: "daraja", ...names, DARAJA_SANDBOX_CALLBACK_URL: callback });
      expect(config).toMatchObject({ mode: "daraja", ready: false, verification: "incomplete" });
      if (config.mode === "daraja") expect(config.missing).toContain("DARAJA_SANDBOX_CALLBACK_URL");
    }
    expect(buildDarajaStkPushRequest("")).toMatchObject({ sent: false, callBackField: "CallBackURL", request: null, reason: "missing-callback-url" });
    expect(buildDarajaStkPushRequest(`http://localhost${DARAJA_CALLBACK_PATH}`).sent).toBe(false);
    expect(DARAJA_STK_PUSH_FIELDS).toContain("CallBackURL");
  });
});

describe("sandbox callback verification", () => {
  const secret = "sandbox-webhook-secret";

  it("rejects a bad signature and accepts the signed payload", () => {
    expect(readSandboxCallback(secret, event, "deadbeef").ok).toBe(false);
    const signature = signSandboxCallback(secret, event);
    expect(readSandboxCallback(secret, event, signature)).toEqual({ ok: true, event });
  });

  it("rejects a mismatched currency before any payment is posted", () => {
    const signature = signSandboxCallback(secret, event);
    const wrong = { ...event, currency: "USD" };
    expect(readSandboxCallback(secret, wrong, signature).ok).toBe(false);
  });
});

const checkoutRequestId = "ws_CO_191220191020363925";

function darajaBody(amount?: number) {
  const metadata = amount === undefined ? undefined : { Item: [{ Name: "Amount", Value: amount }, { Name: "PhoneNumber", Value: 254708374149 }] };
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: "29115-34620561-1",
        CheckoutRequestID: checkoutRequestId,
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        ...(metadata ? { CallbackMetadata: metadata } : {}),
      },
    },
  };
}

describe("Daraja callback handling", () => {
  const pending = { checkoutRequestId, giftMinor: 10_000, status: "pending" };

  it("rejects a malformed payload and does not require the mock signature", async () => {
    expect(parseDarajaStkCallback({ providerEventId: "evt_sandbox_001" }).ok).toBe(false);
    expect(parseDarajaStkCallback({ Body: { stkCallback: { ResultCode: 0 } } }).ok).toBe(false);
    const parsed = parseDarajaStkCallback(darajaBody(100));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.notice).not.toHaveProperty("PhoneNumber");
    const apply = vi.fn();
    const response = await handleSandboxCallback(new Request("https://app.invalid/api/payments/sandbox/callback", {
      method: "POST",
      body: JSON.stringify({ Body: {} }),
    }), { SANDBOX_PROVIDER: "daraja" }, { apply, lookup: async () => null });
    expect(response.status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not post an unknown checkout, a duplicate, a mismatched amount, or an unverified success", () => {
    const parsed = parseDarajaStkCallback(darajaBody(100));
    if (!parsed.ok) throw new Error("expected a parsed callback");
    expect(assessDarajaSettlement({ notice: parsed.notice, stored: null })).toMatchObject({ result: "unknown", postsLedger: false });
    expect(assessDarajaSettlement({ notice: parsed.notice, stored: { ...pending, giftMinor: 20_000 } })).toMatchObject({ result: "mismatch", postsLedger: false });
    expect(assessDarajaSettlement({ notice: parsed.notice, stored: { ...pending, status: "successful" } })).toMatchObject({ result: "duplicate", postsLedger: false });
    expect(assessDarajaSettlement({ notice: parsed.notice, stored: pending })).toMatchObject({ result: "pending", postsLedger: false });
  });

  it("leaves a Daraja callback unposted when the callback URL is missing", async () => {
    const apply = vi.fn();
    const response = await handleSandboxCallback(new Request("https://app.invalid/api/payments/sandbox/callback", {
      method: "POST",
      body: JSON.stringify(darajaBody(100)),
    }), { SANDBOX_PROVIDER: "daraja", DARAJA_SANDBOX_SHORTCODE: "174379" }, { apply, lookup: async () => pending });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "Sandbox payments are not configured.", result: "pending" });
    expect(apply).not.toHaveBeenCalled();
  });
});

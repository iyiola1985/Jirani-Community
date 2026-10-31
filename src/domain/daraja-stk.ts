/** Safaricom posts Lipa Na M-Pesa Online callbacks to this path. */
export const DARAJA_CALLBACK_PATH = "/api/payments/sandbox/callback";

/** Documented STK Push fields. CallBackURL is required by that request. */
export const DARAJA_STK_PUSH_FIELDS = [
  "BusinessShortCode",
  "Password",
  "Timestamp",
  "TransactionType",
  "Amount",
  "PartyA",
  "PartyB",
  "PhoneNumber",
  "CallBackURL",
  "AccountReference",
  "TransactionDesc",
] as const;

export type DarajaStkPushRequest = {
  BusinessShortCode: string;
  Password: string;
  Timestamp: string;
  TransactionType: "CustomerPayBillOnline";
  Amount: string;
  PartyA: string;
  PartyB: string;
  PhoneNumber: string;
  CallBackURL: string;
  AccountReference: string;
  TransactionDesc: string;
};

/** Sandbox sending stays off. Credentials and a callback URL do not flip this. */
export const DARAJA_SANDBOX_SEND_ENABLED = false;

export const DARAJA_SANDBOX_URLS = {
  oauth: "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
  stkPush: "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
  stkQuery: "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query",
  transactionStatus: "https://sandbox.safaricom.co.ke/mpesa/transactionstatus/v1/query",
} as const;

/**
 * Lipa Na M-Pesa Online requires CallBackURL. The app does not send this request.
 * A built body is only a local value. Safaricom is not contacted.
 */
export function buildDarajaStkPushRequest(callbackUrl: string | undefined): {
  sent: false;
  callBackField: "CallBackURL";
  request: DarajaStkPushRequest | null;
  reason: "missing-callback-url" | "verification-incomplete";
} {
  return {
    sent: DARAJA_SANDBOX_SEND_ENABLED,
    callBackField: "CallBackURL",
    request: null,
    reason: acceptsPublicDarajaCallbackUrl(callbackUrl) ? "verification-incomplete" : "missing-callback-url",
  };
}

export function darajaTimestamp(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}${value("month")}${value("day")}${value("hour")}${value("minute")}${value("second")}`;
}

export function darajaPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

/** Local STK body. Host checks for sending are separate and stay fail-closed. */
export function assembleDarajaStkPushBody(input: {
  shortcode: string;
  passkey: string;
  timestamp: string;
  amountShillings: number;
  phone: string;
  callbackUrl: string;
  accountReference: string;
  transactionDesc: string;
}): { ok: true; body: DarajaStkPushRequest } | { ok: false; reason: "missing-callback-url" | "invalid-request" } {
  if (!callbackUrlShapeOk(input.callbackUrl)) return { ok: false, reason: "missing-callback-url" };
  if (!/^[0-9]{5,7}$/.test(input.shortcode) || !/^[0-9]{14}$/.test(input.timestamp)) {
    return { ok: false, reason: "invalid-request" };
  }
  if (input.passkey.trim().length < 8) return { ok: false, reason: "invalid-request" };
  if (!Number.isSafeInteger(input.amountShillings) || input.amountShillings < 100 || input.amountShillings > 2_000_000) {
    return { ok: false, reason: "invalid-request" };
  }
  if (!/^254[0-9]{9}$/.test(input.phone)) return { ok: false, reason: "invalid-request" };
  if (!/^[A-Za-z0-9]{1,12}$/.test(input.accountReference)) return { ok: false, reason: "invalid-request" };
  if (input.transactionDesc.trim().length < 1 || input.transactionDesc.trim().length > 13) {
    return { ok: false, reason: "invalid-request" };
  }
  return {
    ok: true,
    body: {
      BusinessShortCode: input.shortcode,
      Password: darajaPassword(input.shortcode, input.passkey, input.timestamp),
      Timestamp: input.timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: String(input.amountShillings),
      PartyA: input.phone,
      PartyB: input.shortcode,
      PhoneNumber: input.phone,
      CallBackURL: input.callbackUrl,
      AccountReference: input.accountReference,
      TransactionDesc: input.transactionDesc.trim(),
    },
  };
}

export function assembleDarajaStkQueryBody(input: {
  shortcode: string;
  passkey: string;
  timestamp: string;
  checkoutRequestId: string;
}): { ok: true; body: { BusinessShortCode: string; Password: string; Timestamp: string; CheckoutRequestID: string } } | { ok: false; reason: "invalid-request" } {
  if (!/^[0-9]{5,7}$/.test(input.shortcode) || !/^[0-9]{14}$/.test(input.timestamp) || !/^ws_CO_[A-Za-z0-9_]{6,57}$/.test(input.checkoutRequestId)) {
    return { ok: false, reason: "invalid-request" };
  }
  return {
    ok: true,
    body: {
      BusinessShortCode: input.shortcode,
      Password: darajaPassword(input.shortcode, input.passkey, input.timestamp),
      Timestamp: input.timestamp,
      CheckoutRequestID: input.checkoutRequestId,
    },
  };
}

function callbackUrlShapeOk(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== DARAJA_CALLBACK_PATH) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return false;
  if (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(host)) return false;
  return host.length > 0;
}

export function acceptsPublicDarajaCallbackUrl(value: string | undefined): boolean {
  return acceptsPublicDarajaHttpsUrl(value, DARAJA_CALLBACK_PATH);
}

/** Public HTTPS URL whose path is exactly the route that should receive it. */
export function acceptsPublicDarajaHttpsUrl(value: string | undefined, pathname: string): boolean {
  if (!value?.trim() || !pathname.startsWith("/")) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== pathname) return false;
  return !isBlockedCallbackHost(url.hostname);
}

function isBlockedCallbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true;
  if (host.endsWith(".local") || host.endsWith(".localhost")) return true;
  if (host === "example.com" || host === "example.org" || host === "example.net" || host.endsWith(".example") || host.endsWith(".example.net") || host.endsWith(".test") || host.endsWith(".invalid")) return true;
  if (/^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(host)) return true;
  if (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(host)) return true;
  return false;
}

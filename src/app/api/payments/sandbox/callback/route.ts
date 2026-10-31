import { assessDarajaSettlement, parseDarajaStkCallback, type StoredDarajaAttempt } from "@/domain/daraja-callback";
import { decideDarajaLedgerPost } from "@/domain/daraja-ledger-gate";
import { readSandboxCallback, type SandboxCallback } from "@/domain/sandbox-callback";
import { classifySandboxConfig, type SandboxEnv } from "@/domain/sandbox-config";
import { applyVerifiedSandboxCallback } from "@/server/sandbox-payments";

const MAX_BYTES = 4096;

type CallbackDeps = {
  apply: (event: SandboxCallback) => Promise<Record<string, unknown>>;
  lookup: (checkoutRequestId: string) => Promise<StoredDarajaAttempt | null>;
};

const disabledDarajaLookup: CallbackDeps["lookup"] = async () => null;

export async function POST(request: Request) {
  return handleSandboxCallback(request, {
    SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER,
    SANDBOX_WEBHOOK_SECRET: process.env.SANDBOX_WEBHOOK_SECRET,
    DARAJA_SANDBOX_CONSUMER_KEY: process.env.DARAJA_SANDBOX_CONSUMER_KEY,
    DARAJA_SANDBOX_CONSUMER_SECRET: process.env.DARAJA_SANDBOX_CONSUMER_SECRET,
    DARAJA_SANDBOX_PASSKEY: process.env.DARAJA_SANDBOX_PASSKEY,
    DARAJA_SANDBOX_SHORTCODE: process.env.DARAJA_SANDBOX_SHORTCODE,
    DARAJA_SANDBOX_CALLBACK_URL: process.env.DARAJA_SANDBOX_CALLBACK_URL,
  });
}

export async function handleSandboxCallback(
  request: Request,
  env: SandboxEnv,
  deps: CallbackDeps = { apply: applyVerifiedSandboxCallback, lookup: disabledDarajaLookup },
): Promise<Response> {
  const config = classifySandboxConfig(env);
  switch (config.mode) {
    case "unconfigured":
      return Response.json({ error: "Sandbox payments are not configured." }, { status: 503 });
    case "mock":
      return handleMockCallback(request, config.webhookSecret, deps.apply);
    case "daraja":
      return handleDarajaCallback(request, config.missing.includes("DARAJA_SANDBOX_CALLBACK_URL"), deps);
    default: {
      const unreachable: never = config;
      return unreachable;
    }
  }
}

async function handleMockCallback(
  request: Request,
  secret: string,
  apply: CallbackDeps["apply"],
): Promise<Response> {
  const payload = await readJson(request);
  if (!payload.ok) return payload.response;
  const verified = readSandboxCallback(secret, payload.value, request.headers.get("x-jirani-sandbox-signature") ?? "");
  if (!verified.ok) {
    return Response.json({ error: verified.reason }, { status: 401 });
  }
  const applied = await apply(verified.event);
  return Response.json({ result: applied.result ?? "recorded" });
}

async function handleDarajaCallback(request: Request, callbackUrlMissing: boolean, deps: CallbackDeps): Promise<Response> {
  const payload = await readJson(request);
  if (!payload.ok) return payload.response;
  const parsed = parseDarajaStkCallback(payload.value);
  if (!parsed.ok) {
    return Response.json({ error: parsed.reason }, { status: 400 });
  }
  const stored = await deps.lookup(parsed.notice.checkoutRequestId);
  const decision = assessDarajaSettlement({ notice: parsed.notice, stored });
  const callbackGate = decideDarajaLedgerPost("stk-callback");
  const queryGate = decideDarajaLedgerPost("stk-query");
  if (decision.postsLedger) {
    const unreachable: never = decision.postsLedger;
    return unreachable;
  }
  if (callbackGate.postLedger) {
    const unreachable: never = callbackGate.postLedger;
    return unreachable;
  }
  if (queryGate.postLedger) {
    const unreachable: never = queryGate.postLedger;
    return unreachable;
  }
  const error = callbackUrlMissing
    ? "Sandbox payments are not configured."
    : "Daraja status verification is incomplete. Nothing was posted.";
  return Response.json({ error, result: decision.result }, { status: 503 });
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const raw = await request.text();
  if (raw.length > MAX_BYTES) {
    return { ok: false, response: Response.json({ error: "The callback payload is too large." }, { status: 413 }) };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, response: Response.json({ error: "The callback payload is not JSON." }, { status: 400 }) };
  }
}

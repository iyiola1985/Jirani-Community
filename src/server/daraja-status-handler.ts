import "server-only";

import { decideDarajaLedgerPost } from "@/domain/daraja-ledger-gate";
import {
  assessDarajaTransactionStatus,
  classifyTransactionStatusConfig,
  parseDarajaQueueTimeout,
  parseDarajaTransactionStatusCallback,
  type BoundDarajaPayment,
  type TransactionStatusEnv,
} from "@/domain/daraja-transaction-status";

const MAX_BYTES = 4096;

const DISABLED = "Daraja transaction status is disabled. Nothing was posted.";

type StatusDeps = {
  lookup: (receipt: string) => Promise<BoundDarajaPayment | null>;
};

const noPayment: StatusDeps["lookup"] = async () => null;

export async function handleTransactionStatusResult(
  request: Request,
  env: TransactionStatusEnv,
  deps: StatusDeps = { lookup: noPayment },
): Promise<Response> {
  const payload = await readJson(request);
  if (!payload.ok) return payload.response;
  const parsed = parseDarajaTransactionStatusCallback(payload.value);
  if (!parsed.ok) {
    return Response.json({ error: "The transaction status result is malformed. Nothing was posted." }, { status: 400 });
  }
  const config = classifyTransactionStatusConfig(env);
  switch (parsed.message.kind) {
    case "acknowledgement": {
      const gate = decideDarajaLedgerPost("transaction-status-acknowledgement");
      if (gate.postLedger) {
        const unreachable: never = gate.postLedger;
        return unreachable;
      }
      return Response.json(
        { error: "The transaction status acknowledgement is not a payment result. Nothing was posted.", result: "pending", provesPayment: false },
        { status: 503 },
      );
    }
    case "result": {
      const gate = decideDarajaLedgerPost("transaction-status-result");
      const stored = await deps.lookup(parsed.message.receiptNo);
      const decision = assessDarajaTransactionStatus({ result: parsed.message, stored });
      if (gate.postLedger) {
        const unreachable: never = gate.postLedger;
        return unreachable;
      }
      if (decision.postsLedger) {
        const unreachable: never = decision.postsLedger;
        return unreachable;
      }
      if (config.enabled) {
        const unreachable: never = config.enabled;
        return unreachable;
      }
      return Response.json({ error: DISABLED, result: decision.result, provesPayment: false }, { status: 503 });
    }
    default: {
      const unreachable: never = parsed.message;
      return unreachable;
    }
  }
}

export async function handleTransactionStatusTimeout(request: Request, env: TransactionStatusEnv): Promise<Response> {
  const payload = await readJson(request);
  if (!payload.ok) return payload.response;
  const parsed = parseDarajaQueueTimeout(payload.value);
  if (!parsed.ok) {
    return Response.json({ error: "The transaction status timeout is malformed. Nothing was posted." }, { status: 400 });
  }
  const config = classifyTransactionStatusConfig(env);
  const gate = decideDarajaLedgerPost("transaction-status-timeout");
  if (gate.postLedger) {
    const unreachable: never = gate.postLedger;
    return unreachable;
  }
  if (parsed.postsLedger) {
    const unreachable: never = parsed.postsLedger;
    return unreachable;
  }
  if (config.enabled) {
    const unreachable: never = config.enabled;
    return unreachable;
  }
  return Response.json(
    { error: "Daraja transaction status is disabled. The timeout is not a payment. Nothing was posted.", result: "pending", provesPayment: false },
    { status: 503 },
  );
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

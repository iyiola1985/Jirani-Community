import { createHmac, timingSafeEqual } from "node:crypto";

import { DomainError } from "@/domain/errors";

export const SANDBOX_OUTCOMES = ["successful", "failed", "cancelled", "reversed"] as const;
export type SandboxOutcome = (typeof SANDBOX_OUTCOMES)[number];

export type SandboxCallback = {
  providerEventId: string;
  providerReference: string;
  reportedStatus: SandboxOutcome;
  amountMinor: number;
  currency: "KES";
};

export function signSandboxCallback(secret: string, input: SandboxCallback): string {
  if (secret.length < 16) {
    throw new DomainError("provider_config", "The sandbox webhook secret must be at least 16 characters.");
  }
  return createHmac("sha256", secret).update(canonical(input)).digest("hex");
}

export function readSandboxCallback(
  secret: string,
  payload: unknown,
  signature: string,
): { ok: true; event: SandboxCallback } | { ok: false; reason: string } {
  if (secret.length < 16) return { ok: false, reason: "Sandbox payments are not configured." };
  const event = parseCallback(payload);
  if (!event) return { ok: false, reason: "The callback payload is not a sandbox payment event." };
  const expected = signSandboxCallback(secret, event);
  if (!safeEqualHex(expected, signature)) {
    return { ok: false, reason: "The callback signature did not match." };
  }
  return { ok: true, event };
}

function parseCallback(payload: unknown): SandboxCallback | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const providerEventId = typeof body.providerEventId === "string" ? body.providerEventId : "";
  const providerReference = typeof body.providerReference === "string" ? body.providerReference : "";
  const reportedStatus = SANDBOX_OUTCOMES.find((item) => item === body.reportedStatus);
  const amountMinor = body.amountMinor;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(providerEventId)) return null;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(providerReference)) return null;
  if (!reportedStatus) return null;
  if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  if (body.currency !== "KES") return null;
  return { providerEventId, providerReference, reportedStatus, amountMinor, currency: "KES" };
}

function canonical(input: SandboxCallback): string {
  return `${input.providerEventId}|${input.providerReference}|${input.reportedStatus}|${input.amountMinor}|${input.currency}`;
}

function safeEqualHex(expected: string, received: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

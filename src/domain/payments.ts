import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { DomainError } from "@/domain/errors";
import { assertMinor } from "@/domain/money";
import type { PaymentStatus } from "@/domain/types";

export type ProviderInit = {
  provider: "mock";
  simulated: true;
  providerReference: string;
  status: "pending";
  amountMinor: number;
  currency: "KES";
  idempotencyKey: string;
  notice: "Simulated checkout. No money moves.";
};

type ProviderRecord = {
  providerReference: string;
  idempotencyKey: string;
  amountMinor: number;
  currency: "KES";
  status: PaymentStatus;
  clientReference: string;
};

export type CallbackInput = {
  providerEventId: string;
  providerReference: string;
  reportedStatus: Extract<PaymentStatus, "successful" | "failed" | "reversed">;
  amountMinor: number;
  signature: string;
};

export type CallbackResult = {
  accepted: boolean;
  duplicate: boolean;
  status: PaymentStatus;
  reason: string;
};

/**
 * In-memory stand-in for a future payment provider.
 * Status changes only through a signed callback or a signed refund.
 * A browser return value is never an input here.
 */
export class MockPaymentProvider {
  readonly id = "mock" as const;
  readonly simulated = true as const;
  private readonly secret: string;
  private readonly byIdempotency = new Map<string, ProviderRecord>();
  private readonly byReference = new Map<string, ProviderRecord>();
  private readonly eventStatus = new Map<string, PaymentStatus>();
  private readonly refunds = new Map<string, { providerReference: string; amountMinor: number }>();

  constructor(secret: string) {
    if (secret.length < 16) {
      throw new DomainError("provider_config", "The mock provider secret must be at least 16 characters.");
    }
    this.secret = secret;
  }

  initiate(input: {
    idempotencyKey: string;
    amountMinor: number;
    currency: "KES";
    clientReference: string;
  }): { duplicate: boolean; init: ProviderInit } {
    assertMinor(input.amountMinor, "Payment");
    if (!input.idempotencyKey) {
      throw new DomainError("idempotency", "A contribution needs an idempotency key.");
    }
    const existing = this.byIdempotency.get(input.idempotencyKey);
    if (existing) {
      if (existing.amountMinor !== input.amountMinor || existing.currency !== input.currency) {
        throw new DomainError("idempotency_conflict", "That idempotency key was already used for a different amount.");
      }
      return { duplicate: true, init: this.toInit(existing) };
    }
    const record: ProviderRecord = {
      providerReference: `mock_${randomUUID()}`,
      idempotencyKey: input.idempotencyKey,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: "pending",
      clientReference: input.clientReference,
    };
    this.byIdempotency.set(record.idempotencyKey, record);
    this.byReference.set(record.providerReference, record);
    return { duplicate: false, init: this.toInit(record) };
  }

  /** Test and demo setup for contributions that already settled inside the fixture. */
  seedSettled(input: {
    providerReference: string;
    idempotencyKey: string;
    amountMinor: number;
    status: PaymentStatus;
    clientReference: string;
  }): void {
    if (this.byReference.has(input.providerReference)) {
      throw new DomainError("provider", "That simulated reference already exists.");
    }
    const record: ProviderRecord = {
      providerReference: input.providerReference,
      idempotencyKey: input.idempotencyKey,
      amountMinor: input.amountMinor,
      currency: "KES",
      status: input.status,
      clientReference: input.clientReference,
    };
    this.byIdempotency.set(record.idempotencyKey, record);
    this.byReference.set(record.providerReference, record);
  }

  signCallback(input: {
    providerEventId: string;
    providerReference: string;
    reportedStatus: CallbackInput["reportedStatus"];
    amountMinor: number;
  }): string {
    return createHmac("sha256", this.secret).update(canonical(input)).digest("hex");
  }

  handleCallback(input: CallbackInput): CallbackResult {
    const record = this.byReference.get(input.providerReference);
    if (!record) {
      return { accepted: false, duplicate: false, status: "pending", reason: "Unknown simulated reference." };
    }
    const expected = this.signCallback(input);
    if (!safeEqualHex(expected, input.signature)) {
      return { accepted: false, duplicate: false, status: record.status, reason: "The callback signature did not match." };
    }
    if (input.amountMinor !== record.amountMinor) {
      return { accepted: false, duplicate: false, status: record.status, reason: "The callback amount does not match the original request." };
    }
    const seen = this.eventStatus.get(input.providerEventId);
    if (seen) {
      return { accepted: true, duplicate: true, status: record.status, reason: "Duplicate callback ignored." };
    }
    const next = transitionPayment(record.status, input.reportedStatus);
    this.eventStatus.set(input.providerEventId, next);
    record.status = next;
    return { accepted: true, duplicate: false, status: next, reason: "Simulated provider accepted the callback." };
  }

  verifyStatus(providerReference: string): {
    simulated: true;
    verifiedWithProvider: true;
    status: PaymentStatus;
    amountMinor: number;
  } {
    const record = this.byReference.get(providerReference);
    if (!record) throw new DomainError("provider", "Unknown simulated reference.");
    return {
      simulated: true,
      verifiedWithProvider: true,
      status: record.status,
      amountMinor: record.amountMinor,
    };
  }

  refund(input: { providerReference: string; amountMinor: number; idempotencyKey: string }): {
    simulated: true;
    providerReference: string;
    status: PaymentStatus;
    duplicate: boolean;
  } {
    assertMinor(input.amountMinor, "Refund");
    if (input.amountMinor === 0) throw new DomainError("refund", "A refund needs an amount.");
    const record = this.byReference.get(input.providerReference);
    if (!record) throw new DomainError("provider", "Unknown simulated reference.");
    const existing = this.refunds.get(input.idempotencyKey);
    if (existing) {
      if (existing.providerReference !== record.providerReference || existing.amountMinor !== input.amountMinor) {
        throw new DomainError("idempotency_conflict", "That refund idempotency key was already used.");
      }
      return { simulated: true, providerReference: record.providerReference, status: record.status, duplicate: true };
    }
    if (record.status !== "successful") {
      throw new DomainError("refund", "Only a successful simulated payment can be refunded.");
    }
    const already = [...this.refunds.values()]
      .filter((refund) => refund.providerReference === record.providerReference)
      .reduce((sum, refund) => sum + refund.amountMinor, 0);
    if (already + input.amountMinor > record.amountMinor) {
      throw new DomainError("refund", "The refund is larger than the remaining simulated payment.");
    }
    this.refunds.set(input.idempotencyKey, {
      providerReference: record.providerReference,
      amountMinor: input.amountMinor,
    });
    if (already + input.amountMinor === record.amountMinor) record.status = "reversed";
    return { simulated: true, providerReference: record.providerReference, status: record.status, duplicate: false };
  }

  private toInit(record: ProviderRecord): ProviderInit {
    return {
      provider: "mock",
      simulated: true,
      providerReference: record.providerReference,
      status: "pending",
      amountMinor: record.amountMinor,
      currency: "KES",
      idempotencyKey: record.idempotencyKey,
      notice: "Simulated checkout. No money moves.",
    };
  }
}

export function statusAfterBrowserReturn(
  browserClaim: string | null,
  verifiedStatus: PaymentStatus,
): PaymentStatus {
  void browserClaim;
  return verifiedStatus;
}

function canonical(input: {
  providerEventId: string;
  providerReference: string;
  reportedStatus: string;
  amountMinor: number;
}): string {
  return `${input.providerEventId}|${input.providerReference}|${input.reportedStatus}|${input.amountMinor}`;
}

function safeEqualHex(expected: string, received: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function transitionPayment(current: PaymentStatus, reported: CallbackInput["reportedStatus"]): PaymentStatus {
  if (current === "pending" && (reported === "successful" || reported === "failed")) return reported;
  if (current === "successful" && reported === "reversed") return "reversed";
  throw new DomainError(
    "payment_transition",
    `A simulated payment cannot move from ${current} to ${reported}.`,
  );
}

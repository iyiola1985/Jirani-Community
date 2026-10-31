import "server-only";

import { randomUUID } from "node:crypto";

import { classifySandboxConfig } from "@/domain/sandbox-config";
import type { SandboxCallback } from "@/domain/sandbox-callback";
import { DomainError } from "@/domain/errors";
import { simulatedGiftMinor } from "@/domain/money";
import type { Actor } from "@/domain/types";
import { withActor, withDatabase } from "@/server/db-actor";

export type SandboxPaymentView = {
  id: string;
  internalReference: string;
  providerReference: string | null;
  provider: string;
  title: string;
  targetKind: "request" | "campaign";
  targetId: string;
  giftMinor: number;
  providerFeeMinor: number | null;
  status: string;
  contributionId: string | null;
  ledgerPosted: boolean;
  lastError: string | null;
  createdAt: string;
  verifiedAt: string | null;
};

function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function minor(value: unknown): number {
  const amount = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new DomainError("invalid_amount", "The payment amount could not be read.");
  }
  return amount;
}

function raise(error: unknown): never {
  if (error instanceof DomainError) throw error;
  const message = error instanceof Error ? error.message : "";
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "P0001" || code === "23514" || code === "23505") throw new DomainError("payment", message);
  if (code === "42501") throw new DomainError("forbidden", "That payment record cannot be changed.");
  console.error(error);
  throw new DomainError("unavailable", "The sandbox payment could not be recorded. Nothing was marked as paid.");
}

function sandboxEnv() {
  return classifySandboxConfig({
    SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER,
    SANDBOX_WEBHOOK_SECRET: process.env.SANDBOX_WEBHOOK_SECRET,
    DARAJA_SANDBOX_CONSUMER_KEY: process.env.DARAJA_SANDBOX_CONSUMER_KEY,
    DARAJA_SANDBOX_CONSUMER_SECRET: process.env.DARAJA_SANDBOX_CONSUMER_SECRET,
    DARAJA_SANDBOX_PASSKEY: process.env.DARAJA_SANDBOX_PASSKEY,
    DARAJA_SANDBOX_SHORTCODE: process.env.DARAJA_SANDBOX_SHORTCODE,
    DARAJA_SANDBOX_CALLBACK_URL: process.env.DARAJA_SANDBOX_CALLBACK_URL,
  });
}

export function sandboxNotice(): string {
  const config = sandboxEnv();
  if (config.mode === "mock") {
    return "A sandbox test payment stays pending until a signed callback is checked on the server. Opening the next page does not pay, and it is not M-Pesa.";
  }
  if (config.mode === "daraja") {
    return "Sandbox payments are not configured. A public HTTPS callback is required, Daraja is not contacted, and a callback alone is not a payment.";
  }
  return "Sandbox payments are not configured. No M-Pesa request is sent, and nothing here is marked as paid.";
}

export function sandboxCanStart(): boolean {
  return sandboxEnv().mode === "mock";
}

const PAYMENT_SQL = `
  SELECT p.id, p.internal_reference, p.provider_reference, p.provider,
         coalesce(r.title, c.title, 'Payment') AS title,
         CASE WHEN p.request_id IS NULL THEN 'campaign' ELSE 'request' END AS target_kind,
         coalesce(p.request_id, p.campaign_id) AS target_id,
         p.gift_minor, p.provider_fee_minor, p.status, p.contribution_id,
         p.last_error, p.created_at, p.verified_at,
         EXISTS (
           SELECT 1 FROM ledger_entries e
           WHERE e.contribution_id = p.contribution_id AND e.entry_type = 'gift'
         ) AS ledger_posted
  FROM sandbox_payments p
  LEFT JOIN assistance_requests r ON r.id = p.request_id
  LEFT JOIN campaigns c ON c.id = p.campaign_id
`;

function mapPayment(row: Record<string, unknown>): SandboxPaymentView {
  return {
    id: text(row.id),
    internalReference: text(row.internal_reference),
    providerReference: row.provider_reference ? text(row.provider_reference) : null,
    provider: text(row.provider),
    title: text(row.title),
    targetKind: row.target_kind === "campaign" ? "campaign" : "request",
    targetId: text(row.target_id),
    giftMinor: minor(row.gift_minor),
    providerFeeMinor: row.provider_fee_minor === null || row.provider_fee_minor === undefined ? null : minor(row.provider_fee_minor),
    status: text(row.status),
    contributionId: row.contribution_id ? text(row.contribution_id) : null,
    ledgerPosted: row.ledger_posted === true,
    lastError: row.last_error ? text(row.last_error) : null,
    createdAt: text(row.created_at),
    verifiedAt: row.verified_at ? text(row.verified_at) : null,
  };
}

export async function startSandboxPayment(input: {
  actor: Actor;
  requestId: string | null;
  campaignId: string | null;
  shillings: number;
  recognition: "public" | "anonymous";
  publicName: string;
  idempotencyKey: string;
}): Promise<{ id: string; status: string }> {
  const config = sandboxEnv();
  if (config.mode === "daraja") {
    throw new DomainError("provider_config", "Sandbox payments are not configured. No payment was started.");
  }
  if (config.mode !== "mock") {
    throw new DomainError("provider_config", "Sandbox payments are not configured. No payment was started.");
  }
  if (!input.actor.roles.includes("donor")) {
    throw new DomainError("forbidden", "Sign in with a donor account to start a sandbox payment.");
  }
  const giftMinor = simulatedGiftMinor(input.shillings);
  const reference = `sbx_${randomUUID().replaceAll("-", "")}`;
  try {
    return await withActor(input.actor, async (client) => {
      const begun = await client.query(
        `SELECT jirani.begin_sandbox_payment($1, $2, $3, $4, $5, $6, 'sandbox-mock') AS created`,
        [
          input.requestId,
          input.campaignId,
          giftMinor,
          input.recognition,
          input.publicName,
          input.idempotencyKey,
        ],
      );
      const created = begun.rows[0]?.created as { id?: string; status?: string; duplicate?: boolean };
      const id = text(created?.id);
      if (created?.duplicate && created.status !== "created") {
        return { id, status: text(created.status) };
      }
      await client.query(`SELECT jirani.attach_sandbox_reference($1, $2)`, [id, reference]);
      return { id, status: "pending" };
    });
  } catch (error) {
    raise(error);
  }
}

/**
 * Signed mock sandbox callbacks only. jirani.apply_sandbox_verification
 * returns disabled for a daraja-sandbox row and does not write a contribution
 * or a ledger entry. Daraja routes do not call this function.
 */
export async function applyVerifiedSandboxCallback(event: SandboxCallback): Promise<Record<string, unknown>> {
  const applied = await withDatabase(async (client) => {
    const result = await client.query(
      `SELECT jirani.apply_sandbox_verification($1, $2, $3, $4, $5) AS applied`,
      [event.providerReference, event.providerEventId, event.reportedStatus, event.amountMinor, event.currency],
    );
    return result.rows[0]?.applied as Record<string, unknown>;
  });
  if (!applied) throw new DomainError("unavailable", "The sandbox payment could not be recorded. Nothing was marked as paid.");
  return applied;
}

export async function readSandboxPayment(actor: Actor, id: string): Promise<SandboxPaymentView | null> {
  return withActor(actor, async (client) => {
    const result = await client.query(`${PAYMENT_SQL} WHERE p.id::text = $1 OR p.internal_reference = $1 LIMIT 1`, [id]);
    return result.rows[0] ? mapPayment(result.rows[0]) : null;
  });
}

export async function listSandboxPayments(actor: Actor, reference: string): Promise<SandboxPaymentView[]> {
  if (!actor.roles.includes("administrator")) {
    throw new DomainError("forbidden", "Only an administrator can review sandbox payments.");
  }
  return withActor(actor, async (client) => {
    const result = await client.query(
      `${PAYMENT_SQL}
       WHERE $1 = ''
          OR p.internal_reference = $1
          OR p.provider_reference = $1
          OR p.status::text = $1
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [reference],
    );
    return result.rows.map((row) => mapPayment(row));
  });
}

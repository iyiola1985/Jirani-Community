import "server-only";

import type { PoolClient } from "pg";

import { DomainError } from "@/domain/errors";
import { simulatedGiftMinor } from "@/domain/money";
import { PAYMENT_STATUSES, type Actor, type PaymentStatus } from "@/domain/types";
import { withActor, withDatabase } from "@/server/db-actor";

export type StoredContribution = {
  id: string;
  requestId: string | null;
  campaignId: string | null;
  requestTitle: string;
  giftMinor: number;
  netToCauseMinor: number;
  status: PaymentStatus;
  providerReference: string;
  recognition: "public" | "anonymous";
  publicName: string | null;
  simulated: true;
  createdAt: string;
  settledAt: string | null;
  receiptNumber: string | null;
};

export type PublicGift = {
  displayName: string;
  giftMinor: number;
};

export type FinanceRow = StoredContribution & {
  requestStatus: string;
};

export type FinanceEvent = {
  id: string;
  kind: "gift" | "refund" | "adjustment" | "payment";
  amountMinor: number | null;
  detail: string;
  reference: string;
  createdAt: string;
};

export type FinanceOverview = {
  successfulCount: number;
  pendingCount: number;
  failedCount: number;
  reversalCount: number;
  simulatedTotalMinor: number;
  rows: FinanceRow[];
  events: FinanceEvent[];
};

type Started = {
  id: string;
  providerReference: string;
  status: PaymentStatus;
  duplicate: boolean;
};

function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function minor(value: unknown): number {
  const amount = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new DomainError("invalid_amount", "The ledger returned an amount that is not a whole number of cents.");
  }
  return amount;
}

function paymentStatus(value: unknown): PaymentStatus {
  const status = String(value);
  const known = PAYMENT_STATUSES.find((item) => item === status);
  if (!known) throw new DomainError("ledger", "The contribution status could not be read.");
  return known;
}

function recognition(value: unknown): "public" | "anonymous" {
  if (value === "public" || value === "anonymous") return value;
  throw new DomainError("ledger", "The recognition choice could not be read.");
}

function raise(error: unknown): never {
  if (error instanceof DomainError) throw error;
  const message = error instanceof Error ? error.message : "";
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "P0001") throw new DomainError("ledger", message);
  if (code === "42501") throw new DomainError("forbidden", "That financial record cannot be changed.");
  console.error(error);
  throw new DomainError("unavailable", "The simulated gift could not be recorded. No money was taken.");
}

function mapContribution(row: Record<string, unknown>): StoredContribution {
  return {
    id: text(row.id),
    requestId: row.request_id ? text(row.request_id) : null,
    campaignId: row.campaign_id ? text(row.campaign_id) : null,
    requestTitle: text(row.request_title),
    giftMinor: minor(row.gift_minor),
    netToCauseMinor: minor(row.net_to_cause_minor),
    status: paymentStatus(row.status),
    providerReference: text(row.provider_reference),
    recognition: recognition(row.recognition),
    publicName: row.public_name ? text(row.public_name) : null,
    simulated: true,
    createdAt: text(row.created_at),
    settledAt: row.settled_at ? text(row.settled_at) : null,
    receiptNumber: row.receipt_number ? text(row.receipt_number) : null,
  };
}

export async function listDonorContributions(actor: Actor): Promise<StoredContribution[]> {
  return withActor(actor, async (client) => {
    const result = await client.query("SELECT * FROM jirani.donor_contributions(NULL)");
    return result.rows.map((row) => mapContribution(row));
  });
}

export async function readOwnContribution(actor: Actor, contributionId: string): Promise<StoredContribution | null> {
  return withActor(actor, async (client) => {
    const result = await client.query("SELECT * FROM jirani.donor_contributions($1)", [contributionId]);
    const row = result.rows[0];
    return row ? mapContribution(row) : null;
  });
}

export async function listPublicGifts(requestId: string): Promise<PublicGift[]> {
  const gifts = await withDatabase(async (client) => {
    const result = await client.query(
      "SELECT display_name, gift_minor FROM jirani.public_acknowledgements($1)",
      [requestId],
    );
    return result.rows.map((row) => ({
      displayName: text(row.display_name),
      giftMinor: minor(row.gift_minor),
    }));
  });
  return gifts ?? [];
}

export async function recordSimulatedContribution(input: {
  actor: Actor;
  requestId: string;
  shillings: number;
  recognition: "public" | "anonymous";
  publicName: string;
  idempotencyKey: string;
}): Promise<Started> {
  const giftMinor = simulatedGiftMinor(input.shillings);
  try {
    return await withActor(input.actor, async (client) => {
      const result = await client.query(
        `SELECT jirani.record_simulated_contribution($1, $2, $3, $4, $5) AS created`,
        [input.requestId, giftMinor, input.recognition, input.publicName, input.idempotencyKey],
      );
      const created = result.rows[0]?.created as {
        id?: string;
        providerReference?: string;
        status?: string;
        duplicate?: boolean;
      };
      return {
        id: text(created?.id),
        providerReference: text(created?.providerReference),
        status: paymentStatus(created?.status),
        duplicate: created?.duplicate === true,
      };
    });
  } catch (error) {
    raise(error);
  }
}

export async function recordSimulatedCampaignContribution(input: {
  actor: Actor;
  campaignId: string;
  shillings: number;
  recognition: "public" | "anonymous";
  publicName: string;
  idempotencyKey: string;
}): Promise<Started> {
  const giftMinor = simulatedGiftMinor(input.shillings);
  try {
    return await withActor(input.actor, async (client) => {
      const result = await client.query(
        `SELECT jirani.record_simulated_campaign_contribution($1, $2, $3, $4, $5) AS created`,
        [input.campaignId, giftMinor, input.recognition, input.publicName, input.idempotencyKey],
      );
      const created = result.rows[0]?.created as {
        id?: string;
        providerReference?: string;
        status?: string;
        duplicate?: boolean;
      };
      return {
        id: text(created?.id),
        providerReference: text(created?.providerReference),
        status: paymentStatus(created?.status),
        duplicate: created?.duplicate === true,
      };
    });
  } catch (error) {
    raise(error);
  }
}

export async function settleSimulatedContribution(input: {
  actor: Actor;
  contributionId: string;
  outcome: "successful" | "failed";
  providerEventId: string;
}): Promise<{ status: PaymentStatus; duplicate: boolean; receiptNumber: string | null }> {
  try {
    return await withActor(input.actor, async (client) => {
      const result = await client.query(
        `SELECT jirani.settle_simulated_contribution($1, $2, $3) AS settled`,
        [input.contributionId, input.outcome, input.providerEventId],
      );
      const settled = result.rows[0]?.settled as {
        status?: string;
        duplicate?: boolean;
        receiptNumber?: string | null;
      };
      return {
        status: paymentStatus(settled?.status),
        duplicate: settled?.duplicate === true,
        receiptNumber: settled?.receiptNumber ? text(settled.receiptNumber) : null,
      };
    });
  } catch (error) {
    raise(error);
  }
}

export async function reverseSimulatedContribution(input: {
  actor: Actor;
  contributionId: string;
  shillings: number;
  reason: string;
  idempotencyKey: string;
}): Promise<void> {
  if (!input.actor.roles.includes("administrator")) {
    throw new DomainError("forbidden", "Only an administrator can record a reversal.");
  }
  const amountMinor = simulatedGiftMinor(input.shillings);
  if (input.reason.trim().length < 8) {
    throw new DomainError("reason_required", "Record a reason of at least 8 characters.");
  }
  try {
    await withActor(input.actor, async (client) => {
      await client.query(`SELECT jirani.record_simulated_reversal($1, $2, $3, $4)`, [
        input.contributionId,
        amountMinor,
        input.reason.trim(),
        input.idempotencyKey,
      ]);
    });
  } catch (error) {
    raise(error);
  }
}

export async function listFinance(actor: Actor, reference: string): Promise<FinanceOverview> {
  if (!actor.roles.includes("administrator")) {
    throw new DomainError("forbidden", "Only an administrator can open the demonstration ledger.");
  }
  const needle = reference.trim();
  return withActor(actor, (client) => financeQuery(client, needle));
}

async function financeQuery(client: PoolClient, reference: string): Promise<FinanceOverview> {
  const counts = await client.query(
    `SELECT
       count(*) FILTER (WHERE status = 'successful') AS successful_count,
       count(*) FILTER (WHERE status = 'pending') AS pending_count,
       count(*) FILTER (WHERE status = 'failed') AS failed_count,
       coalesce(sum(net_to_cause_minor) FILTER (WHERE status = 'successful'), 0) AS successful_minor
     FROM contributions
     WHERE simulated = true AND provider = 'mock'`,
  );
  const reversals = await client.query(
    `SELECT count(*) AS reversal_count, coalesce(sum(amount_minor), 0) AS reversal_minor
     FROM ledger_entries WHERE entry_type = 'refund'`,
  );
  const rows = await client.query(
    `SELECT c.id, c.request_id, c.campaign_id,
            coalesce(r.title, camp.title) AS request_title,
            coalesce(r.status::text, camp.status::text) AS request_status,
            c.gift_minor, c.net_to_cause_minor, c.status, c.provider_reference,
            c.recognition,
            CASE WHEN c.public_name_retired THEN NULL ELSE c.public_name END AS public_name,
            c.created_at, c.settled_at, receipts.receipt_number
     FROM contributions c
     LEFT JOIN assistance_requests r ON r.id = c.request_id
     LEFT JOIN campaigns camp ON camp.id = c.campaign_id
     LEFT JOIN receipts ON receipts.contribution_id = c.id
     WHERE c.simulated = true
       AND ($1 = '' OR c.provider_reference = $1 OR receipts.receipt_number = $1 OR c.idempotency_key = $1)
     ORDER BY c.created_at DESC
     LIMIT 50`,
    [reference],
  );
  const events = await client.query(
    `SELECT * FROM (
       SELECT e.id, e.entry_type AS kind, e.amount_minor, e.reason AS detail, c.provider_reference AS reference, e.created_at
       FROM ledger_entries e
       JOIN contributions c ON c.id = e.contribution_id
       WHERE $1 = '' OR c.provider_reference = $1
       UNION ALL
       SELECT pe.id, 'payment'::text, NULL::bigint, pe.outcome || ' ' || pe.verified_status, c.provider_reference, pe.created_at
       FROM payment_events pe
       JOIN contributions c ON c.id = pe.contribution_id
       WHERE $1 = '' OR c.provider_reference = $1
     ) history
     ORDER BY created_at DESC
     LIMIT 80`,
    [reference],
  );
  const countRow = counts.rows[0] ?? {};
  const reversalRow = reversals.rows[0] ?? {};
  const successfulMinor = minor(countRow.successful_minor ?? 0);
  const reversalMinor = minor(reversalRow.reversal_minor ?? 0);
  return {
    successfulCount: Number(countRow.successful_count ?? 0),
    pendingCount: Number(countRow.pending_count ?? 0),
    failedCount: Number(countRow.failed_count ?? 0),
    reversalCount: Number(reversalRow.reversal_count ?? 0),
    simulatedTotalMinor: successfulMinor + reversalMinor,
    rows: rows.rows.map((row) => ({ ...mapContribution(row), requestStatus: text(row.request_status) })),
    events: events.rows.map((row) => ({
      id: text(row.id),
      kind: eventKind(row.kind),
      amountMinor: row.amount_minor === null || row.amount_minor === undefined ? null : minor(row.amount_minor),
      detail: text(row.detail),
      reference: text(row.reference),
      createdAt: text(row.created_at),
    })),
  };
}

function eventKind(value: unknown): FinanceEvent["kind"] {
  switch (value) {
    case "gift":
    case "refund":
    case "adjustment":
    case "payment":
      return value;
    default:
      return "payment";
  }
}

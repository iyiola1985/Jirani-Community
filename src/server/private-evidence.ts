import "server-only";

import type { PoolClient } from "pg";

import {
  evidenceAccessDecision,
  evidenceCategory,
  evidenceDownloadHeaders,
  evidenceExtension,
  EVIDENCE_REVIEW_STATUSES,
  isPrivateStorageKey,
  reviewEvidenceDecision,
  type EvidenceCategory,
  type EvidenceContentType,
  type EvidenceReviewStatus,
} from "@/domain/evidence";
import { DomainError } from "@/domain/errors";
import { assertNever } from "@/domain/assert-never";
import type { Actor } from "@/domain/types";
import { withActor } from "@/server/db-actor";
import { readPrivateEvidence, removePrivateEvidence } from "@/server/evidence-files";

export type EvidenceRecord = {
  id: string;
  ownerId: string;
  requestId: string | null;
  campaignId: string | null;
  fileName: string;
  contentType: string;
  byteSize: number;
  stored: boolean;
  category: EvidenceCategory;
  description: string;
  reviewStatus: EvidenceReviewStatus;
  reviewNote: string;
  reviewedAt: string | null;
  /** False when the database has not recorded a review status yet. */
  reviewTracked: boolean;
  scanStatus: "not_scanned";
  durationMeasured: false;
  createdAt: string;
};

const RICH_COLUMNS = `
  id, owner_profile_id, request_id, campaign_id, file_name, content_type, byte_size, storage_key,
  category, description, review_status, review_note, reviewed_at, created_at
`;

const LEGACY_COLUMNS = `
  id, owner_profile_id, request_id, file_name, content_type, byte_size, storage_key, created_at
`;

function text(value: unknown): string {
  return typeof value === "string" ? value : value instanceof Date ? value.toISOString() : "";
}

function pgCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

function categoryOf(value: unknown): EvidenceCategory {
  return evidenceCategory(text(value)) ?? "other_supporting";
}

function reviewOf(value: unknown): EvidenceReviewStatus {
  return EVIDENCE_REVIEW_STATUSES.find((item) => item === value) ?? "pending_review";
}

function mapRich(row: Record<string, unknown>): EvidenceRecord {
  return {
    id: text(row.id),
    ownerId: text(row.owner_profile_id),
    requestId: row.request_id ? text(row.request_id) : null,
    campaignId: row.campaign_id ? text(row.campaign_id) : null,
    fileName: text(row.file_name),
    contentType: text(row.content_type),
    byteSize: Number(row.byte_size),
    stored: Boolean(row.storage_key),
    category: categoryOf(row.category),
    description: text(row.description),
    reviewStatus: reviewOf(row.review_status),
    reviewNote: text(row.review_note),
    reviewedAt: row.reviewed_at ? text(row.reviewed_at) : null,
    reviewTracked: true,
    scanStatus: "not_scanned",
    durationMeasured: false,
    createdAt: text(row.created_at),
  };
}

function mapLegacy(row: Record<string, unknown>): EvidenceRecord {
  return {
    id: text(row.id),
    ownerId: text(row.owner_profile_id),
    requestId: row.request_id ? text(row.request_id) : null,
    campaignId: null,
    fileName: text(row.file_name),
    contentType: text(row.content_type),
    byteSize: Number(row.byte_size),
    stored: Boolean(row.storage_key),
    category: "other_supporting",
    description: "",
    reviewStatus: "pending_review",
    reviewNote: "",
    reviewedAt: null,
    reviewTracked: false,
    scanStatus: "not_scanned",
    durationMeasured: false,
    createdAt: text(row.created_at),
  };
}

async function selectEvidence(client: PoolClient, where: string, values: unknown[]): Promise<EvidenceRecord[]> {
  await client.query("SAVEPOINT evidence_shape");
  try {
    const result = await client.query(
      `SELECT ${RICH_COLUMNS} FROM private_evidence_metadata WHERE ${where} ORDER BY created_at ASC`,
      values,
    );
    await client.query("RELEASE SAVEPOINT evidence_shape");
    return result.rows.map((row) => mapRich(row));
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT evidence_shape");
    if (pgCode(error) !== "42703") throw error;
    if (where.includes("campaign_id")) return [];
  }
  const result = await client.query(
    `SELECT ${LEGACY_COLUMNS} FROM private_evidence_metadata WHERE ${where} ORDER BY created_at ASC`,
    values,
  );
  return result.rows.map((row) => mapLegacy(row));
}

export async function listRequestEvidence(client: PoolClient, requestId: string): Promise<EvidenceRecord[]> {
  return selectEvidence(client, "request_id = $1", [requestId]);
}

export async function listCampaignEvidence(actor: Actor, campaignId: string): Promise<EvidenceRecord[]> {
  return withActor(actor, (client) => selectEvidence(client, "campaign_id = $1", [campaignId]));
}

export async function readEvidenceGap(client: PoolClient, requestId: string): Promise<string> {
  await client.query("SAVEPOINT evidence_gap_read");
  try {
    const result = await client.query(
      `SELECT evidence_gap FROM assistance_request_private WHERE request_id = $1`,
      [requestId],
    );
    await client.query("RELEASE SAVEPOINT evidence_gap_read");
    return text(result.rows[0]?.evidence_gap);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT evidence_gap_read");
    if (pgCode(error) === "42703") return "";
    throw error;
  }
}

export async function writeEvidenceGap(client: PoolClient, requestId: string, gap: string): Promise<void> {
  if (!gap) return;
  await client.query("SAVEPOINT evidence_gap_write");
  try {
    await client.query(
      `UPDATE assistance_request_private SET evidence_gap = $2, updated_at = now() WHERE request_id = $1`,
      [requestId, gap],
    );
    await client.query("RELEASE SAVEPOINT evidence_gap_write");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT evidence_gap_write");
    if (pgCode(error) === "42703") {
      throw new DomainError(
        "unavailable",
        "A note about a missing document needs the latest database migration before it can be saved. The application was not changed.",
      );
    }
    throw error;
  }
}

export async function insertPrivateEvidence(
  client: PoolClient,
  input: {
    requestId: string | null;
    campaignId: string | null;
    ownerId: string;
    fileName: string;
    contentType: EvidenceContentType;
    byteSize: number;
    sha256: string;
    storageKey: string;
    category: EvidenceCategory;
    description: string;
  },
): Promise<void> {
  const inserted = await client.query(
    `INSERT INTO private_evidence_metadata (
       request_id, campaign_id, owner_profile_id, file_name, content_type, byte_size, sha256, storage_key,
       category, description, review_status, scan_status, duration_measured
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending_review', 'not_scanned', false)
     RETURNING id`,
    [
      input.requestId,
      input.campaignId,
      input.ownerId,
      input.fileName,
      input.contentType,
      input.byteSize,
      input.sha256,
      input.storageKey,
      input.category,
      input.description,
    ],
  );
  await client.query(
    `SELECT jirani.write_audit($1, 'evidence.added', 'private_evidence', $2::uuid, $3, $4::jsonb)`,
    [
      input.ownerId,
      text(inserted.rows[0]?.id),
      "Private evidence was stored.",
      JSON.stringify({ category: input.category, byteSize: input.byteSize }),
    ],
  );
}

export async function evidenceForActor(actor: Actor, requestId: string, evidenceId: string): Promise<EvidenceRecord | null> {
  return withActor(actor, async (client) => {
    const rows = await selectEvidence(client, "id = $1 AND request_id = $2", [evidenceId, requestId]);
    return rows[0] ?? null;
  });
}

export function evidenceFailure(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const code = pgCode(error);
  const message = error instanceof Error ? error.message : "";
  if (code === "42703" || code === "42883") {
    return new DomainError(
      "unavailable",
      "Document review needs the latest database migration before it can be saved. Nothing was published.",
    );
  }
  const readable = [
    "maximum number of files",
    "evidence review status cannot be changed",
    "only an administrator can review",
    "you cannot review evidence",
    "watch the video",
    "already submitted stays",
    "reviewed file stays",
    "only an administrator can remove",
    "you can only remove your own",
    "record a reason",
    "that evidence status",
    "that evidence file does not exist",
  ];
  if (readable.some((part) => message.toLowerCase().includes(part))) {
    return new DomainError("evidence", message);
  }
  console.error("evidence request failed");
  return new DomainError("unavailable", "The document could not be saved.");
}

export async function countEvidence(client: PoolClient, parent: "request" | "campaign", id: string): Promise<number> {
  const sql = parent === "request"
    ? `SELECT count(*)::int AS total FROM private_evidence_metadata WHERE request_id = $1`
    : `SELECT count(*)::int AS total FROM private_evidence_metadata WHERE campaign_id = $1`;
  if (parent !== "request" && parent !== "campaign") return assertNever(parent);
  const result = await client.query(sql, [id]);
  return Number(result.rows[0]?.total ?? 0);
}

export async function reviewPrivateEvidence(input: {
  actor: Actor;
  evidenceId: string;
  ownerId: string;
  contentType: string;
  next: string;
  note: string;
  watcherConfirmed: boolean;
}): Promise<void> {
  const decision = reviewEvidenceDecision(input);
  if (!decision.ok) throw new DomainError("evidence", decision.error);
  try {
    await withActor(input.actor, async (client) => {
      await client.query(`SELECT jirani.review_private_evidence($1::uuid, $2, $3, $4)`, [
        input.evidenceId,
        decision.status,
        input.note.trim(),
        input.watcherConfirmed,
      ]);
    });
  } catch (error) {
    throw evidenceFailure(error);
  }
}

export async function removePendingEvidence(actor: Actor, evidenceId: string): Promise<void> {
  let storageKey = "";
  try {
    storageKey = await withActor(actor, async (client) => {
      const result = await client.query(`SELECT jirani.remove_pending_evidence($1::uuid) AS storage_key`, [evidenceId]);
      return text(result.rows[0]?.storage_key);
    });
  } catch (error) {
    throw evidenceFailure(error);
  }
  if (isPrivateStorageKey(storageKey)) {
    await removePrivateEvidence(storageKey).catch(() => undefined);
  }
}

function deniedStatus(decision: "unauthenticated" | "forbidden" | "hidden"): 401 | 403 | 404 {
  switch (decision) {
    case "unauthenticated":
      return 401;
    case "forbidden":
      return 403;
    case "hidden":
      return 404;
    default:
      return assertNever(decision);
  }
}

export async function openEvidenceDownload(input: {
  actor: Actor | null;
  audience: "recipient" | "administrator";
  requestId: string | null;
  campaignId: string | null;
  evidenceId: string;
}): Promise<{ status: 200; body: Uint8Array; headers: Record<string, string> } | { status: 401 | 403 | 404 }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.evidenceId)) return { status: 404 };
  const actor = input.actor;
  const early = evidenceAccessDecision({
    actor,
    ownerId: "00000000-0000-4000-8000-000000000000",
    audience: input.audience,
  });
  if (!actor) return { status: input.audience === "administrator" ? 403 : 401 };
  if (early === "forbidden") return { status: 403 };
  if (input.requestId && input.campaignId) return { status: 404 };
  const parentId = input.requestId ?? input.campaignId;
  if (!parentId) return { status: 404 };
  const found = await withActor(actor, async (client) => {
    const result = input.requestId
      ? await client.query(
          `SELECT id, owner_profile_id, file_name, content_type, storage_key
           FROM private_evidence_metadata
           WHERE id = $1 AND request_id = $2`,
          [input.evidenceId, parentId],
        )
      : await client.query(
          `SELECT id, owner_profile_id, file_name, content_type, storage_key
           FROM private_evidence_metadata
           WHERE id = $1 AND campaign_id = $2`,
          [input.evidenceId, parentId],
        );
    return result.rows[0] as Record<string, unknown> | undefined;
  }).catch(() => undefined);
  if (!found?.storage_key) return { status: 404 };
  const ownerId = text(found.owner_profile_id);
  const decision = evidenceAccessDecision({ actor, ownerId, audience: input.audience });
  if (decision !== "allow") return { status: deniedStatus(decision) };
  const contentType = text(found.content_type);
  if (!evidenceExtension(contentType)) return { status: 404 };
  const storageKey = text(found.storage_key);
  if (!isPrivateStorageKey(storageKey)) return { status: 404 };
  let bytes: Buffer;
  try {
    bytes = await readPrivateEvidence(storageKey);
  } catch {
    return { status: 404 };
  }
  await withActor(actor, async (client) => {
    await client.query(
      `SELECT jirani.write_audit($1, 'evidence.downloaded', 'private_evidence', $2::uuid, $3, '{}'::jsonb)`,
      [actor.id, input.evidenceId, "An authorised user downloaded private evidence."],
    );
  });
  return {
    status: 200,
    body: new Uint8Array(bytes),
    headers: evidenceDownloadHeaders(text(found.file_name), contentType as EvidenceContentType),
  };
}

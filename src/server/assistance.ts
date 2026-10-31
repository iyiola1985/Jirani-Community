import "server-only";

import type { PoolClient } from "pg";

import { brand } from "@/config/brand";
import { DomainError } from "@/domain/errors";
import { applicantCanAttachEvidence, PUBLIC_REQUEST_COLUMNS, unattachedStorageKeys, unverifiedEvidenceHold, MAX_EVIDENCE_FILES } from "@/domain/evidence";
import type { EvidenceContentType } from "@/domain/evidence";
import { submissionIntent } from "@/domain/validation";
import type { ValidRequestForm } from "@/domain/validation";
import {
  CATEGORIES,
  REQUEST_STATUSES,
  VERIFICATION_STATUSES,
  type Actor,
  type Category,
  type PublicRequest,
  type RequestStatus,
  type VerificationStatus,
} from "@/domain/types";
import { withActor, withDatabase } from "@/server/db-actor";
import { removePrivateEvidence, writePrivateEvidence } from "@/server/evidence-files";
import {
  countEvidence,
  insertPrivateEvidence,
  listRequestEvidence,
  readEvidenceGap,
  writeEvidenceGap,
  type EvidenceRecord,
} from "@/server/private-evidence";

export const REQUEST_PAGE_SIZE = 9;

export type StoredRequest = {
  id: string;
  ownerId: string;
  publicAlias: string;
  category: Category;
  preferredAssistance: Category;
  title: string;
  summary: string;
  county: string;
  locality: string;
  amountNeededMinor: number;
  urgent: boolean;
  status: RequestStatus;
  demo: boolean;
  privateNotes: string;
  reason: string;
  applicantFeedback: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  closedAt: string | null;
  clientToken: string;
  evidenceGap: string;
};

export type StatusEvent = {
  id: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus;
  reason: string;
  createdAt: string;
};

export type ReviewNote = {
  id: string;
  body: string;
  createdAt: string;
};

export type { EvidenceRecord };

export type RecipientOverview = {
  verificationStatus: VerificationStatus;
  counts: Record<RequestStatus, number>;
  requests: StoredRequest[];
  recent: Array<{ id: string; requestId: string; title: string; toStatus: RequestStatus; reason: string; createdAt: string }>;
};

type EvidenceUpload = {
  fileName: string;
  contentType: EvidenceContentType;
  bytes: Uint8Array;
  sha256: string;
  category: EvidenceRecord["category"];
  description: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : value instanceof Date ? value.toISOString() : "";
}

function category(value: unknown): Category {
  return CATEGORIES.includes(value as Category) ? (value as Category) : "other";
}

function status(value: unknown): RequestStatus {
  return REQUEST_STATUSES.includes(value as RequestStatus) ? (value as RequestStatus) : "draft";
}

function verification(value: unknown): VerificationStatus {
  return VERIFICATION_STATUSES.includes(value as VerificationStatus) ? (value as VerificationStatus) : "not_started";
}

function mapRequest(row: Record<string, unknown>): StoredRequest {
  const preferred = category(row.preferred_assistance || row.category);
  return {
    id: text(row.id),
    ownerId: text(row.recipient_profile_id),
    publicAlias: text(row.public_alias),
    category: category(row.category),
    preferredAssistance: preferred,
    title: text(row.title),
    summary: text(row.public_summary),
    county: text(row.county),
    locality: text(row.locality),
    amountNeededMinor: Number(row.amount_needed_minor),
    urgent: row.urgent === true,
    status: status(row.status),
    demo: row.demo === true,
    privateNotes: text(row.situation_notes),
    reason: text(row.reason),
    applicantFeedback: text(row.applicant_feedback),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    publishedAt: row.published_at ? text(row.published_at) : null,
    closedAt: row.closed_at ? text(row.closed_at) : null,
    clientToken: text(row.client_token),
    evidenceGap: "",
  };
}

const REQUEST_COLUMNS = `
  r.id, r.recipient_profile_id, r.public_alias, r.category, r.preferred_assistance, r.title,
  r.public_summary, r.county, r.locality, r.amount_needed_minor, r.urgent, r.status, r.demo,
  r.created_at, r.updated_at, r.published_at, r.closed_at, r.client_token,
  coalesce(p.situation_notes, '') AS situation_notes,
  coalesce(p.reason, '') AS reason,
  coalesce(p.applicant_feedback, '') AS applicant_feedback
`;

function raise(error: unknown): never {
  if (error instanceof DomainError) throw error;
  const message = error instanceof Error ? error.message : "";
  const readable = [
    "only the recipient",
    "only another administrator",
    "illegal request status",
    "public request details are locked",
    "verify the recipient",
    "new requests start",
    "requested amount is locked",
    "record a reason",
    "that verification status",
    "that applicant does not",
    "you cannot review your own",
  ];
  if (readable.some((part) => message.toLowerCase().includes(part))) {
    throw new DomainError("request_transition", message);
  }
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "42703" || code === "42883") {
    throw new DomainError("unavailable", "Document review needs the latest database migration before it can be saved. Nothing was published.");
  }
  if (code === "23505") throw new DomainError("duplicate", "This application was already saved.");
  console.error("request save failed");
  throw new DomainError("unavailable", "The request could not be saved.");
}

async function events(client: PoolClient, requestId: string): Promise<StatusEvent[]> {
  const result = await client.query(
    `SELECT id, from_status, to_status, reason, created_at
     FROM request_status_events WHERE request_id = $1 ORDER BY created_at ASC`,
    [requestId],
  );
  return result.rows.map((row) => ({
    id: text(row.id),
    fromStatus: row.from_status ? status(row.from_status) : null,
    toStatus: status(row.to_status),
    reason: text(row.reason),
    createdAt: text(row.created_at),
  }));
}

async function evidenceRows(client: PoolClient, requestId: string): Promise<EvidenceRecord[]> {
  return listRequestEvidence(client, requestId);
}

export async function recipientOverview(actor: Actor): Promise<RecipientOverview> {
  return withActor(actor, async (client) => {
    const counts = Object.fromEntries(REQUEST_STATUSES.map((item) => [item, 0])) as Record<RequestStatus, number>;
    const countRows = await client.query(
      `SELECT status, count(*)::int AS total
       FROM assistance_requests
       WHERE recipient_profile_id = jirani.profile_id()
       GROUP BY status`,
    );
    for (const row of countRows.rows) counts[status(row.status)] = Number(row.total);
    const verificationRow = await client.query(
      `SELECT status FROM recipient_verifications WHERE profile_id = jirani.profile_id()`,
    );
    const requestRows = await client.query(
      `SELECT ${REQUEST_COLUMNS}
       FROM assistance_requests r
       LEFT JOIN assistance_request_private p ON p.request_id = r.id
       WHERE r.recipient_profile_id = jirani.profile_id()
       ORDER BY r.updated_at DESC`,
    );
    const recent = await client.query(
      `SELECT e.id, e.request_id, e.to_status, e.reason, e.created_at, r.title
       FROM request_status_events e
       JOIN assistance_requests r ON r.id = e.request_id
       WHERE r.recipient_profile_id = jirani.profile_id()
       ORDER BY e.created_at DESC
       LIMIT 8`,
    );
    return {
      verificationStatus: verification(verificationRow.rows[0]?.status),
      counts,
      requests: requestRows.rows.map((row) => mapRequest(row)),
      recent: recent.rows.map((row) => ({
        id: text(row.id),
        requestId: text(row.request_id),
        title: text(row.title),
        toStatus: status(row.to_status),
        reason: text(row.reason),
        createdAt: text(row.created_at),
      })),
    };
  }).catch(raise);
}

export async function readOwnedRequest(actor: Actor, requestId: string): Promise<{
  request: StoredRequest;
  events: StatusEvent[];
  evidence: EvidenceRecord[];
} | null> {
  return withActor(actor, async (client) => {
    const result = await client.query(
      `SELECT ${REQUEST_COLUMNS}
       FROM assistance_requests r
       LEFT JOIN assistance_request_private p ON p.request_id = r.id
       WHERE r.id = $1 AND r.recipient_profile_id = jirani.profile_id()`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const request = mapRequest(row);
    request.evidenceGap = await readEvidenceGap(client, requestId);
    return { request, events: await events(client, requestId), evidence: await evidenceRows(client, requestId) };
  }).catch(raise);
}

export async function saveAssistance(input: {
  actor: Actor;
  intent: "draft" | "submit";
  clientToken: string;
  value: ValidRequestForm;
  evidence: EvidenceUpload[];
  evidenceGap: string;
}): Promise<{ id: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.clientToken)) {
    throw new DomainError("validation", "The application could not be identified. Start again from the form.");
  }
  const stored: string[] = [];
  try {
    for (const file of input.evidence) {
      stored.push(await writePrivateEvidence(file.contentType, file.bytes));
    }
    const saved = await withActor(input.actor, async (client) => {
      const existing = await client.query(
        `SELECT id, status, recipient_profile_id FROM assistance_requests WHERE client_token = $1`,
        [input.clientToken],
      );
      const current = existing.rows[0];
      if (current && text(current.recipient_profile_id) !== input.actor.id) {
        throw new DomainError("forbidden", "This application belongs to another account.");
      }
      const intent = submissionIntent(current ? status(current.status) : null, input.intent);
      if (intent === "duplicate") {
        throw new DomainError("duplicate", "This application was already submitted. Open it from your dashboard to follow its status.");
      }
      const fields = [
        input.value.publicAlias,
        input.value.category,
        input.value.preferredAssistance,
        input.value.title,
        input.value.summary,
        input.value.county,
        input.value.locality,
        input.value.amountMinor,
        input.value.urgent,
      ];
      let requestId = current ? text(current.id) : "";
      if (!current) {
        const inserted = await client.query(
          `INSERT INTO assistance_requests (
             recipient_profile_id, public_alias, category, preferred_assistance, title, public_summary,
             county, locality, amount_needed_minor, urgent, status, demo, client_token
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', false, $11)
           RETURNING id`,
          [input.actor.id, ...fields, input.clientToken],
        );
        requestId = text(inserted.rows[0].id);
        await client.query(
          `INSERT INTO assistance_request_private (request_id, situation_notes, reason) VALUES ($1, $2, $3)`,
          [requestId, input.value.privateNotes, input.value.reason],
        );
      } else {
        await client.query(
          `UPDATE assistance_requests SET
             public_alias = $2, category = $3, preferred_assistance = $4, title = $5, public_summary = $6,
             county = $7, locality = $8, amount_needed_minor = $9, urgent = $10
           WHERE id = $1`,
          [requestId, ...fields],
        );
        await client.query(
          `UPDATE assistance_request_private SET situation_notes = $2, reason = $3, updated_at = now() WHERE request_id = $1`,
          [requestId, input.value.privateNotes, input.value.reason],
        );
      }
      await writeEvidenceGap(client, requestId, input.evidenceGap);
      if (input.evidence.length > 0) {
        const existingFiles = await countEvidence(client, "request", requestId);
        if (existingFiles + input.evidence.length > MAX_EVIDENCE_FILES) {
          throw new DomainError("evidence", "This application already has the maximum number of files.");
        }
        for (let index = 0; index < input.evidence.length; index += 1) {
          const file = input.evidence[index];
          const storageKey = stored[index];
          if (!file || !storageKey) continue;
          await insertPrivateEvidence(client, {
            requestId,
            campaignId: null,
            ownerId: input.actor.id,
            fileName: file.fileName,
            contentType: file.contentType,
            byteSize: file.bytes.byteLength,
            sha256: file.sha256,
            storageKey,
            category: file.category,
            description: file.description,
          });
        }
      }
      if (input.intent === "submit") {
        await client.query(`SELECT set_config('jirani.status_reason', $1, true)`, ["Submitted by the applicant."]);
        await client.query(`UPDATE assistance_requests SET status = 'submitted' WHERE id = $1`, [requestId]);
        await client.query(
          `INSERT INTO consent_records (profile_id, consent_type, policy_version, consent_status)
           VALUES
             ($1, 'request_submission', $2, 'granted'),
             ($1, 'verification', $2, 'granted'),
             ($1, 'request_publication', $2, 'granted'),
             ($1, 'privacy', $2, 'granted')`,
          [input.actor.id, brand.policyVersion],
        );
        await client.query(`SELECT jirani.write_audit($1, 'request.submitted', 'assistance_request', $2, $3)`, [
          input.actor.id,
          requestId,
          "The applicant submitted the request for review.",
        ]);
      }
      return { id: requestId };
    });
    stored.length = 0;
    return saved;
  } catch (error) {
    for (const key of unattachedStorageKeys(stored, false)) {
      await removePrivateEvidence(key).catch(() => undefined);
    }
    raise(error);
  }
}

export async function addRequestEvidence(input: {
  actor: Actor;
  requestId: string;
  evidence: EvidenceUpload[];
  evidenceGap: string;
}): Promise<void> {
  if (input.evidence.length === 0 && !input.evidenceGap) {
    throw new DomainError("validation", "Add a file or explain which document is missing.");
  }
  const stored: string[] = [];
  try {
    for (const file of input.evidence) stored.push(await writePrivateEvidence(file.contentType, file.bytes));
    await withActor(input.actor, async (client) => {
      const current = await client.query(
        `SELECT status, recipient_profile_id FROM assistance_requests WHERE id = $1`,
        [input.requestId],
      );
      const row = current.rows[0];
      if (!row || text(row.recipient_profile_id) !== input.actor.id) {
        throw new DomainError("forbidden", "You can only add documents to your own request.");
      }
      if (!applicantCanAttachEvidence(status(row.status))) {
        throw new DomainError("evidence", "Documents can be added while the request is still being prepared or reviewed.");
      }
      await writeEvidenceGap(client, input.requestId, input.evidenceGap);
      if (input.evidence.length === 0) return;
      const existingFiles = await countEvidence(client, "request", input.requestId);
      if (existingFiles + input.evidence.length > MAX_EVIDENCE_FILES) {
        throw new DomainError("evidence", "This application already has the maximum number of files.");
      }
      for (let index = 0; index < input.evidence.length; index += 1) {
        const file = input.evidence[index];
        const storageKey = stored[index];
        if (!file || !storageKey) continue;
        await insertPrivateEvidence(client, {
          requestId: input.requestId,
          campaignId: null,
          ownerId: input.actor.id,
          fileName: file.fileName,
          contentType: file.contentType,
          byteSize: file.bytes.byteLength,
          sha256: file.sha256,
          storageKey,
          category: file.category,
          description: file.description,
        });
      }
    });
    stored.length = 0;
  } catch (error) {
    for (const key of unattachedStorageKeys(stored, false)) {
      await removePrivateEvidence(key).catch(() => undefined);
    }
    raise(error);
  }
}

export async function listPublished(filters: {
  category: Category | null;
  county: string | null;
  urgent: boolean | null;
  funding: "any" | "open" | "met";
  page: number;
}): Promise<{ requests: PublicRequest[]; total: number }> {
  const listed = await withDatabase(async (client) => {
    const values = [filters.category, filters.county, filters.urgent, filters.funding, REQUEST_PAGE_SIZE, (filters.page - 1) * REQUEST_PAGE_SIZE];
    const where = `
      status = 'published'
      AND ($1::text IS NULL OR category = $1)
      AND ($2::text IS NULL OR county = $2)
      AND ($3::boolean IS NULL OR urgent = $3)
      AND (
        $4::text = 'any'
        OR ($4::text = 'open' AND jirani.raised_for_published(id) < amount_needed_minor)
        OR ($4::text = 'met' AND jirani.raised_for_published(id) >= amount_needed_minor)
      )
    `;
    const rows = await client.query(
      `SELECT ${PUBLIC_REQUEST_COLUMNS}, jirani.raised_for_published(id) AS raised
       FROM assistance_requests
       WHERE ${where}
       ORDER BY published_at DESC NULLS LAST
       LIMIT $5 OFFSET $6`,
      values,
    );
    const total = await client.query(`SELECT count(*)::int AS total FROM assistance_requests WHERE ${where}`, values.slice(0, 4));
    return {
      total: Number(total.rows[0]?.total ?? 0),
      requests: rows.rows.map((row) => ({
        id: text(row.id),
        publicAlias: text(row.public_alias),
        category: category(row.category),
        title: text(row.title),
        summary: text(row.public_summary),
        county: text(row.county),
        amountNeededMinor: Number(row.amount_needed_minor),
        raisedMinor: Number(row.raised),
        currency: "KES" as const,
        status: "published" as const,
        demo: row.demo === true,
        urgent: row.urgent === true,
        locality: text(row.locality),
        publishedAt: row.published_at ? text(row.published_at) : null,
      })),
    };
  });
  return listed ?? { requests: [], total: 0 };
}

export async function readPublished(requestId: string): Promise<PublicRequest | null> {
  const found = await withDatabase(async (client) => {
    const result = await client.query(
      `SELECT ${PUBLIC_REQUEST_COLUMNS}, jirani.raised_for_published(id) AS raised
       FROM assistance_requests WHERE id = $1 AND status = 'published'`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: text(row.id),
      publicAlias: text(row.public_alias),
      category: category(row.category),
      title: text(row.title),
      summary: text(row.public_summary),
      county: text(row.county),
      amountNeededMinor: Number(row.amount_needed_minor),
      raisedMinor: Number(row.raised),
      currency: "KES" as const,
      status: "published" as const,
      demo: row.demo === true,
      urgent: row.urgent === true,
      locality: text(row.locality),
      publishedAt: row.published_at ? text(row.published_at) : null,
    } satisfies PublicRequest;
  });
  return found;
}

export async function listReviewQueue(actor: Actor, filters: {
  category: Category | null;
  county: string | null;
  status: RequestStatus | null;
  from: string | null;
  to: string | null;
}): Promise<StoredRequest[]> {
  return withActor(actor, async (client) => {
    const result = await client.query(
      `SELECT ${REQUEST_COLUMNS}
       FROM assistance_requests r
       LEFT JOIN assistance_request_private p ON p.request_id = r.id
       WHERE ($1::text IS NULL OR r.category = $1)
         AND ($2::text IS NULL OR r.county = $2)
         AND ($3::text IS NULL OR r.status::text = $3)
         AND ($4::timestamptz IS NULL OR r.created_at >= $4)
         AND ($5::timestamptz IS NULL OR r.created_at < $5)
       ORDER BY r.created_at DESC
       LIMIT 50`,
      [filters.category, filters.county, filters.status, filters.from, filters.to],
    );
    return result.rows.map((row) => mapRequest(row));
  }).catch(raise);
}

export async function readForReview(actor: Actor, requestId: string): Promise<{
  request: StoredRequest;
  events: StatusEvent[];
  evidence: EvidenceRecord[];
  notes: ReviewNote[];
  verificationStatus: VerificationStatus;
} | null> {
  return withActor(actor, async (client) => {
    const result = await client.query(
      `SELECT ${REQUEST_COLUMNS}
       FROM assistance_requests r
       LEFT JOIN assistance_request_private p ON p.request_id = r.id
       WHERE r.id = $1`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const request = mapRequest(row);
    request.evidenceGap = await readEvidenceGap(client, requestId);
    const verificationRow = await client.query(`SELECT status FROM recipient_verifications WHERE profile_id = $1`, [request.ownerId]);
    const notes = await client.query(
      `SELECT id, body, created_at FROM request_review_notes WHERE request_id = $1 ORDER BY created_at ASC`,
      [requestId],
    );
    return {
      request,
      events: await events(client, requestId),
      evidence: await evidenceRows(client, requestId),
      notes: notes.rows.map((note) => ({ id: text(note.id), body: text(note.body), createdAt: text(note.created_at) })),
      verificationStatus: verification(verificationRow.rows[0]?.status),
    };
  }).catch(raise);
}

export async function transitionLive(input: {
  actor: Actor;
  requestId: string;
  to: RequestStatus;
  reason: string;
  privateNote: string;
}): Promise<void> {
  try {
    await withActor(input.actor, async (client) => {
      const current = await client.query(`SELECT status, recipient_profile_id FROM assistance_requests WHERE id = $1`, [input.requestId]);
      const row = current.rows[0];
      if (!row) throw new DomainError("not_found", "Request not found.");
      if (text(row.recipient_profile_id) === input.actor.id) {
        throw new DomainError("forbidden", "You cannot review your own assistance request.");
      }
      if (input.to === "verified" || input.to === "published") {
        const hold = unverifiedEvidenceHold(await listRequestEvidence(client, input.requestId), "request");
        if (hold) throw new DomainError("request_transition", hold);
      }
      await client.query(`SELECT set_config('jirani.status_reason', $1, true)`, [input.reason]);
      await client.query(`UPDATE assistance_requests SET status = $2::request_status WHERE id = $1`, [input.requestId, input.to]);
      if (input.to === "needs_information" || input.to === "rejected") {
        await client.query(`UPDATE assistance_request_private SET applicant_feedback = $2, updated_at = now() WHERE request_id = $1`, [
          input.requestId,
          input.reason,
        ]);
      }
      if (input.privateNote.trim().length >= 8) {
        await client.query(`INSERT INTO request_review_notes (request_id, author_id, body) VALUES ($1, $2, $3)`, [
          input.requestId,
          input.actor.id,
          input.privateNote.trim(),
        ]);
      }
      await client.query(`SELECT jirani.write_audit($1, 'request.transition', 'assistance_request', $2, $3, $4::jsonb)`, [
        input.actor.id,
        input.requestId,
        input.reason,
        JSON.stringify({ to: input.to, from: text(row.status) }),
      ]);
    });
  } catch (error) {
    raise(error);
  }
}

export async function decideVerification(input: {
  actor: Actor;
  profileId: string;
  to: VerificationStatus;
  reason: string;
}): Promise<void> {
  try {
    await withActor(input.actor, async (client) => {
      await client.query(`SELECT jirani.decide_recipient_verification($1, $2::verification_status, $3)`, [
        input.profileId,
        input.to,
        input.reason,
      ]);
    });
  } catch (error) {
    raise(error);
  }
}

export async function addReviewNote(actor: Actor, requestId: string, body: string): Promise<void> {
  try {
    await withActor(actor, async (client) => {
      await client.query(`INSERT INTO request_review_notes (request_id, author_id, body) VALUES ($1, $2, $3)`, [
        requestId,
        actor.id,
        body,
      ]);
      await client.query(`SELECT jirani.write_audit($1, 'request.note', 'assistance_request', $2, $3)`, [
        actor.id,
        requestId,
        "An administrator added a private review note.",
      ]);
    });
  } catch (error) {
    raise(error);
  }
}

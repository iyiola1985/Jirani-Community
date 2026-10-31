import "server-only";

import type { PoolClient } from "pg";

import { DomainError } from "@/domain/errors";
import { campaignCanAttachEvidence, MAX_EVIDENCE_FILES, unattachedStorageKeys, unverifiedEvidenceHold } from "@/domain/evidence";
import type { EvidenceCategory, EvidenceContentType } from "@/domain/evidence";
import { categoryLabel } from "@/domain/labels";
import type { ValidCampaignDraft } from "@/domain/campaign-form";
import {
  CAMPAIGN_CATEGORIES,
  CAMPAIGN_STATUSES,
  type Actor,
  type CampaignCategory,
  type CampaignStatus,
} from "@/domain/types";
import { withActor, withDatabase } from "@/server/db-actor";
import { removePrivateEvidence, writePrivateEvidence } from "@/server/evidence-files";
import { countEvidence, evidenceFailure, insertPrivateEvidence, listCampaignEvidence } from "@/server/private-evidence";

export type PublicCampaign = {
  id: string;
  slug: string;
  title: string;
  category: CampaignCategory;
  objective: string;
  county: string;
  beneficiaryGroup: string;
  eligibilityCriteria: string;
  selectionRules: string;
  feeDisclosure: string;
  refundPolicy: string;
  surplusPolicy: string;
  cancellationAllowed: boolean;
  imagePath: string | null;
  targetMinor: number;
  raisedMinor: number;
  contributionCount: number;
  startsAt: string;
  endsAt: string;
  status: CampaignStatus;
  acceptingGifts: boolean;
};

export type CampaignAuditEvent = {
  id: string;
  fromStatus: CampaignStatus | null;
  toStatus: CampaignStatus;
  reason: string;
  createdAt: string;
};

export type CampaignSelection = {
  method: "manual";
  eligibleReference: string;
  outcomeSummary: string;
  allocatedMinor: number;
  createdAt: string;
};

export type CampaignReconciliation = {
  netMinor: number;
  contributionCount: number;
  unresolvedNotes: string;
  surplusNote: string;
  fundsSent: false;
  createdAt: string;
};

export type PublicCampaignReport = {
  campaignId: string;
  title: string;
  slug: string;
  narrative: string;
  raisedMinor: number;
  contributionCount: number;
  platformFeeMinor: number;
  allocatedMinor: number;
  paidMinor: number;
  publishedAt: string;
};

export type AdminCampaign = PublicCampaign & {
  createdBy: string | null;
  approvedAt: string | null;
  closedAt: string | null;
  events: CampaignAuditEvent[];
  selection: CampaignSelection | null;
  reconciliation: CampaignReconciliation | null;
  report: PublicCampaignReport | null;
};

export const PUBLIC_COLUMNS = `
  c.id, c.slug, c.title, c.category, c.objective, c.county, c.beneficiary_group,
  c.eligibility_criteria, c.beneficiary_selection_rules, c.fee_disclosure, c.refund_policy,
  c.surplus_policy, c.cancellation_allowed, c.image_path, c.target_amount_minor,
  jirani.raised_for_campaign(c.id) AS raised_minor,
  jirani.campaign_contribution_count(c.id) AS contribution_count,
  c.starts_at, c.ends_at, c.status,
  (c.status = 'active' AND c.starts_at <= now() AND c.ends_at > now()) AS accepting_gifts
`;

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

function campaignStatus(value: unknown): CampaignStatus {
  const status = String(value);
  const known = CAMPAIGN_STATUSES.find((item) => item === status);
  if (!known) throw new DomainError("campaign", "The campaign status could not be read.");
  return known;
}

function campaignCategory(value: unknown): CampaignCategory {
  const category = String(value);
  const known = CAMPAIGN_CATEGORIES.find((item) => item === category);
  if (!known) throw new DomainError("campaign", "The campaign category could not be read.");
  return known;
}

function raise(error: unknown): never {
  if (error instanceof DomainError) throw error;
  const message = error instanceof Error ? error.message : "";
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "P0001" || code === "23514" || code === "23505") throw new DomainError("campaign", message);
  if (code === "42501") throw new DomainError("forbidden", "That campaign record cannot be changed.");
  console.error(error);
  throw new DomainError("unavailable", "The campaign could not be saved.");
}

function mapPublic(row: Record<string, unknown>): PublicCampaign {
  return {
    id: text(row.id),
    slug: text(row.slug),
    title: text(row.title),
    category: campaignCategory(row.category),
    objective: text(row.objective),
    county: text(row.county),
    beneficiaryGroup: text(row.beneficiary_group),
    eligibilityCriteria: text(row.eligibility_criteria),
    selectionRules: text(row.beneficiary_selection_rules),
    feeDisclosure: text(row.fee_disclosure),
    refundPolicy: text(row.refund_policy),
    surplusPolicy: text(row.surplus_policy),
    cancellationAllowed: row.cancellation_allowed === true,
    imagePath: row.image_path ? text(row.image_path) : null,
    targetMinor: minor(row.target_amount_minor),
    raisedMinor: minor(row.raised_minor ?? 0),
    contributionCount: Number(row.contribution_count ?? 0),
    startsAt: text(row.starts_at),
    endsAt: text(row.ends_at),
    status: campaignStatus(row.status),
    acceptingGifts: row.accepting_gifts === true,
  };
}

export function campaignCategoryLabel(category: CampaignCategory): string {
  return categoryLabel(category);
}

export async function listPublicCampaigns(filters: {
  category: CampaignCategory | null;
  county: string | null;
  status: CampaignStatus | null;
  closingBefore: string | null;
}): Promise<PublicCampaign[]> {
  const rows = await withDatabase(async (client) => {
    const result = await client.query(
      `SELECT ${PUBLIC_COLUMNS}
       FROM campaigns c
       WHERE c.demo = false
         AND ($1::text IS NULL OR c.category = $1)
         AND ($2::text IS NULL OR c.county = $2)
         AND ($3::text IS NULL OR c.status::text = $3)
         AND ($4::timestamptz IS NULL OR c.ends_at <= $4)
       ORDER BY c.ends_at ASC`,
      [filters.category, filters.county, filters.status, filters.closingBefore],
    );
    return result.rows.map((row) => mapPublic(row));
  });
  return rows ?? [];
}

export async function readPublicCampaign(idOrSlug: string): Promise<PublicCampaign | null> {
  const row = await withDatabase(async (client) => {
    const result = await client.query(
      `SELECT ${PUBLIC_COLUMNS}
       FROM campaigns c
       WHERE c.demo = false AND (c.slug = $1 OR c.id::text = $1)
       LIMIT 1`,
      [idOrSlug],
    );
    return result.rows[0] ? mapPublic(result.rows[0]) : null;
  });
  return row ?? null;
}

export async function readCampaignTarget(idOrSlug: string): Promise<{ id: string; demo: boolean } | null> {
  const row = await withDatabase(async (client) => {
    const result = await client.query(
      `SELECT id, demo FROM campaigns WHERE slug = $1 OR id::text = $1 LIMIT 1`,
      [idOrSlug],
    );
    const found = result.rows[0];
    return found ? { id: text(found.id), demo: found.demo === true } : null;
  });
  return row ?? null;
}

export async function listCampaignGifts(campaignId: string): Promise<Array<{ displayName: string; giftMinor: number }>> {
  const gifts = await withDatabase(async (client) => {
    const result = await client.query(
      `SELECT display_name, gift_minor FROM jirani.public_campaign_acknowledgements($1)`,
      [campaignId],
    );
    return result.rows.map((row) => ({ displayName: text(row.display_name), giftMinor: minor(row.gift_minor) }));
  });
  return gifts ?? [];
}

export async function readPublicReport(campaignId: string): Promise<Omit<PublicCampaignReport, "campaignId" | "title" | "slug"> | null> {
  const report = await withDatabase(async (client) => {
    const result = await client.query(`SELECT * FROM jirani.public_campaign_report($1)`, [campaignId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      narrative: text(row.narrative),
      raisedMinor: minor(row.raised_minor),
      contributionCount: Number(row.contribution_count ?? 0),
      platformFeeMinor: minor(row.platform_fee_minor),
      allocatedMinor: minor(row.allocated_minor),
      paidMinor: minor(row.paid_minor),
      publishedAt: text(row.published_at),
    };
  });
  return report ?? null;
}

export async function listPublicReports(): Promise<PublicCampaignReport[]> {
  const reports = await withDatabase(async (client) => {
    const result = await client.query(
      `SELECT c.id, c.title, c.slug, p.narrative, p.raised_minor, p.contribution_count,
              p.platform_fee_minor, p.allocated_minor, p.paid_minor, p.published_at
       FROM campaigns c
       CROSS JOIN LATERAL jirani.public_campaign_report(c.id) p
       WHERE c.status = 'reported' AND c.demo = false
       ORDER BY p.published_at DESC`,
    );
    return result.rows.map((row) => ({
      campaignId: text(row.id),
      title: text(row.title),
      slug: text(row.slug),
      narrative: text(row.narrative),
      raisedMinor: minor(row.raised_minor),
      contributionCount: Number(row.contribution_count ?? 0),
      platformFeeMinor: minor(row.platform_fee_minor),
      allocatedMinor: minor(row.allocated_minor),
      paidMinor: minor(row.paid_minor),
      publishedAt: text(row.published_at),
    }));
  });
  return reports ?? [];
}

function requireAdmin(actor: Actor): void {
  if (!actor.roles.includes("administrator")) {
    throw new DomainError("forbidden", "Only an administrator can manage a campaign.");
  }
}

export async function listAdminCampaigns(actor: Actor): Promise<PublicCampaign[]> {
  requireAdmin(actor);
  return withActor(actor, async (client) => {
    const result = await client.query(
      `SELECT ${PUBLIC_COLUMNS}
       FROM campaigns c
       ORDER BY c.updated_at DESC`,
    );
    return result.rows.map((row) => mapPublic(row));
  });
}

async function loadAdmin(client: PoolClient, id: string): Promise<AdminCampaign | null> {
  const result = await client.query(
    `SELECT ${PUBLIC_COLUMNS}, c.created_by, c.approved_at, c.closed_at
     FROM campaigns c
     WHERE c.id::text = $1 OR c.slug = $1
     LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const campaignId = text(row.id);
  const events = await client.query(
    `SELECT id, from_status, to_status, reason, created_at
     FROM campaign_status_events WHERE campaign_id = $1 ORDER BY created_at ASC`,
    [campaignId],
  );
  const selection = await client.query(
    `SELECT method, eligible_reference, outcome_summary, allocated_amount_minor, created_at
     FROM campaign_selections WHERE campaign_id = $1`,
    [campaignId],
  );
  const reconciliation = await client.query(
    `SELECT net_minor, contribution_count, unresolved_notes, surplus_note, funds_sent, created_at
     FROM campaign_reconciliations WHERE campaign_id = $1`,
    [campaignId],
  );
  const report = await client.query(`SELECT * FROM jirani.public_campaign_report($1)`, [campaignId]);
  const selectionRow = selection.rows[0];
  const reconciliationRow = reconciliation.rows[0];
  const reportRow = report.rows[0];
  const base = mapPublic(row);
  return {
    ...base,
    createdBy: row.created_by ? text(row.created_by) : null,
    approvedAt: row.approved_at ? text(row.approved_at) : null,
    closedAt: row.closed_at ? text(row.closed_at) : null,
    events: events.rows.map((event) => ({
      id: text(event.id),
      fromStatus: event.from_status ? campaignStatus(event.from_status) : null,
      toStatus: campaignStatus(event.to_status),
      reason: text(event.reason),
      createdAt: text(event.created_at),
    })),
    selection: selectionRow
      ? {
          method: "manual",
          eligibleReference: text(selectionRow.eligible_reference),
          outcomeSummary: text(selectionRow.outcome_summary),
          allocatedMinor: minor(selectionRow.allocated_amount_minor),
          createdAt: text(selectionRow.created_at),
        }
      : null,
    reconciliation: reconciliationRow
      ? {
          netMinor: minor(reconciliationRow.net_minor),
          contributionCount: Number(reconciliationRow.contribution_count),
          unresolvedNotes: text(reconciliationRow.unresolved_notes),
          surplusNote: text(reconciliationRow.surplus_note),
          fundsSent: false,
          createdAt: text(reconciliationRow.created_at),
        }
      : null,
    report: reportRow
      ? {
          campaignId,
          title: base.title,
          slug: base.slug,
          narrative: text(reportRow.narrative),
          raisedMinor: minor(reportRow.raised_minor),
          contributionCount: Number(reportRow.contribution_count ?? 0),
          platformFeeMinor: minor(reportRow.platform_fee_minor),
          allocatedMinor: minor(reportRow.allocated_minor),
          paidMinor: minor(reportRow.paid_minor),
          publishedAt: text(reportRow.published_at),
        }
      : null,
  };
}

export async function readAdminCampaign(actor: Actor, id: string): Promise<AdminCampaign | null> {
  requireAdmin(actor);
  return withActor(actor, (client) => loadAdmin(client, id));
}

export async function saveCampaign(input: {
  actor: Actor;
  campaignId: string | null;
  draft: ValidCampaignDraft;
  imagePath: string | null;
}): Promise<string> {
  requireAdmin(input.actor);
  try {
    return await withActor(input.actor, async (client) => {
      const result = await client.query(
        `SELECT jirani.save_campaign($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) AS id`,
        [
          input.campaignId,
          input.draft.title,
          input.draft.slug,
          input.draft.category,
          input.draft.objective,
          input.draft.targetMinor,
          input.draft.startsAt,
          input.draft.endsAt,
          input.draft.county,
          input.draft.beneficiaryGroup,
          input.draft.eligibilityCriteria,
          input.draft.selectionRules,
          input.draft.feeDisclosure,
          input.draft.refundPolicy,
          input.draft.surplusPolicy,
          input.draft.cancellationAllowed,
          input.imagePath,
        ],
      );
      return text(result.rows[0]?.id);
    });
  } catch (error) {
    raise(error);
  }
}

export async function addCampaignEvidence(input: {
  actor: Actor;
  campaignId: string;
  evidence: Array<{
    fileName: string;
    contentType: EvidenceContentType;
    bytes: Uint8Array;
    sha256: string;
    category: EvidenceCategory;
    description: string;
  }>;
}): Promise<void> {
  requireAdmin(input.actor);
  if (input.evidence.length === 0) throw new DomainError("validation", "Choose a file to add.");
  const stored: string[] = [];
  try {
    for (const file of input.evidence) stored.push(await writePrivateEvidence(file.contentType, file.bytes));
    await withActor(input.actor, async (client) => {
      const current = await client.query(`SELECT status FROM campaigns WHERE id = $1`, [input.campaignId]);
      const row = current.rows[0];
      if (!row) throw new DomainError("not_found", "Campaign not found.");
      if (!campaignCanAttachEvidence(campaignStatus(row.status))) {
        throw new DomainError("evidence", "Private documents can be added while the campaign is a draft or under review.");
      }
      const existingFiles = await countEvidence(client, "campaign", input.campaignId);
      if (existingFiles + input.evidence.length > MAX_EVIDENCE_FILES) {
        throw new DomainError("evidence", "This campaign already has the maximum number of files.");
      }
      for (let index = 0; index < input.evidence.length; index += 1) {
        const file = input.evidence[index];
        const storageKey = stored[index];
        if (!file || !storageKey) continue;
        await insertPrivateEvidence(client, {
          requestId: null,
          campaignId: input.campaignId,
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
    throw evidenceFailure(error);
  }
}

export async function transitionCampaignRecord(input: {
  actor: Actor;
  campaignId: string;
  nextStatus: CampaignStatus;
  reason: string;
}): Promise<void> {
  requireAdmin(input.actor);
  if (input.nextStatus === "approved") {
    const files = await listCampaignEvidence(input.actor, input.campaignId);
    const hold = unverifiedEvidenceHold(files, "campaign");
    if (hold) throw new DomainError("campaign", hold);
  }
  try {
    await withActor(input.actor, async (client) => {
      await client.query(`SELECT jirani.transition_campaign($1, $2::campaign_status, $3)`, [
        input.campaignId,
        input.nextStatus,
        input.reason.trim(),
      ]);
    });
  } catch (error) {
    raise(error);
  }
}

export async function recordCampaignSelection(input: {
  actor: Actor;
  campaignId: string;
  eligibleReference: string;
  outcomeSummary: string;
  allocatedShillings: number;
}): Promise<void> {
  requireAdmin(input.actor);
  if (!Number.isInteger(input.allocatedShillings) || input.allocatedShillings < 0) {
    throw new DomainError("validation", "Enter a whole number of shillings for the allocation decision.");
  }
  try {
    await withActor(input.actor, async (client) => {
      await client.query(`SELECT jirani.record_campaign_selection($1, $2, $3, $4)`, [
        input.campaignId,
        input.eligibleReference.trim(),
        input.outcomeSummary.trim(),
        input.allocatedShillings * 100,
      ]);
    });
  } catch (error) {
    raise(error);
  }
}

export async function publishCampaignReport(input: {
  actor: Actor;
  campaignId: string;
  narrative: string;
}): Promise<void> {
  requireAdmin(input.actor);
  try {
    await withActor(input.actor, async (client) => {
      await client.query(`SELECT jirani.publish_campaign_report($1, $2)`, [input.campaignId, input.narrative.trim()]);
    });
  } catch (error) {
    raise(error);
  }
}

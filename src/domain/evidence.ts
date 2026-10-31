import { assertNever } from "@/domain/assert-never";
import { DomainError } from "@/domain/errors";
import type { Actor, CampaignStatus, RequestStatus } from "@/domain/types";
import { authorize } from "@/domain/permissions";

const TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
} as const;

export type EvidenceContentType = keyof typeof TYPES;
export type EvidenceExtension = (typeof TYPES)[EvidenceContentType];

export const EVIDENCE_CATEGORIES = [
  "hospital_bill",
  "admission_or_estimate",
  "discharge_or_support",
  "loan_balance",
  "lender_notice",
  "property_damage",
  "official_report",
  "repair_estimate",
  "other_supporting",
] as const;

export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export const EVIDENCE_REVIEW_STATUSES = ["pending_review", "verified", "rejected", "needs_clarification"] as const;
export type EvidenceReviewStatus = (typeof EVIDENCE_REVIEW_STATUSES)[number];

/** Largest single private file. Per-type limits are smaller for images and PDFs. */
export const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024;
export const MAX_EVIDENCE_FILES = 10;
/** One server submission. Enough for a single video plus form fields, not ten videos at once. */
export const MAX_EVIDENCE_SUBMISSION_BYTES = 55 * 1024 * 1024;
export const MAX_EVIDENCE_DESCRIPTION_CHARS = 240;
export const MAX_EVIDENCE_GAP_CHARS = 500;

const IMAGE_LIMIT = 10 * 1024 * 1024;
const PDF_LIMIT = 15 * 1024 * 1024;
const VIDEO_LIMIT = MAX_EVIDENCE_BYTES;

export const EVIDENCE_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,video/mp4,video/webm";

/**
 * Shown to applicants. Video length is not measured, and no malware scanner is configured.
 * The retention sentence is not a legal determination.
 */
export const EVIDENCE_APPLICANT_NOTICE =
  "Evidence helps a reviewer understand the application. It does not guarantee approval, and it is not shown on a public page. PDF, JPEG, PNG, WebP, MP4, and WebM files are accepted. Images are limited to 10 MB, PDFs to 15 MB, and videos to 50 MB, with up to 10 files. Video is optional. This server cannot measure video length, and no malware scanner is configured, so a saved file has not been scanned. Redact account numbers and details the review does not need. If a document is missing, explain that and submit anyway. The application can stay under review until the checks are done. Authorised reviewers can open these files. Jirani does not automatically contact a hospital, lender, police service, or other organisation. Jirani has not set a numbered retention period. Files stay in private storage until a reviewed deletion.";

export const PUBLIC_REQUEST_COLUMNS =
  "id, public_alias, category, title, public_summary, county, amount_needed_minor, currency, urgent, locality, published_at, demo";

export function evidenceExtension(contentType: string): EvidenceExtension | null {
  if (contentType in TYPES) return TYPES[contentType as EvidenceContentType];
  return null;
}

export function evidenceByteLimit(contentType: string): number | null {
  switch (contentType) {
    case "application/pdf":
      return PDF_LIMIT;
    case "image/jpeg":
    case "image/png":
    case "image/webp":
      return IMAGE_LIMIT;
    case "video/mp4":
    case "video/webm":
      return VIDEO_LIMIT;
    default:
      return null;
  }
}

export function evidenceCategory(value: string): EvidenceCategory | null {
  return EVIDENCE_CATEGORIES.find((item) => item === value) ?? null;
}

export function evidenceCategoryLabel(category: EvidenceCategory): string {
  switch (category) {
    case "hospital_bill":
      return "Hospital or medical bill";
    case "admission_or_estimate":
      return "Admission letter or treatment estimate";
    case "discharge_or_support":
      return "Discharge or medical supporting document";
    case "loan_balance":
      return "Loan balance or settlement statement";
    case "lender_notice":
      return "Lender notice or repayment document";
    case "property_damage":
      return "Fire, flood, accident or property damage";
    case "official_report":
      return "Police, incident or official report";
    case "repair_estimate":
      return "Repair quotation or replacement estimate";
    case "other_supporting":
      return "Other supporting evidence";
    default:
      return assertNever(category);
  }
}

export function evidenceReviewLabel(status: EvidenceReviewStatus): string {
  switch (status) {
    case "pending_review":
      return "Pending review";
    case "verified":
      return "Verified for this file";
    case "rejected":
      return "Rejected";
    case "needs_clarification":
      return "Needs clarification";
    default:
      return assertNever(status);
  }
}

export function safeEvidenceLabel(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "document";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80);
  return cleaned || "document";
}

export function isPrivateStorageKey(storageKey: string): boolean {
  return /^[0-9a-f-]{36}\.(pdf|jpg|png|webp|mp4|webm)$/.test(storageKey);
}

/** Keys written during a failed submission may be removed. Keys already attached to an application stay. */
export function unattachedStorageKeys(written: readonly string[], committed: boolean): string[] {
  if (committed) return [];
  return written.filter(isPrivateStorageKey);
}

export function evidenceBytesMatch(contentType: EvidenceContentType, bytes: Uint8Array): boolean {
  switch (contentType) {
    case "application/pdf":
      return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
    case "image/webp":
      return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
    case "video/mp4":
      return bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp";
    case "video/webm":
      return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    default:
      return assertNever(contentType);
  }
}

export type EvidenceInspection =
  | {
      ok: true;
      contentType: EvidenceContentType;
      extension: EvidenceExtension;
      byteSize: number;
      /** Always false. This process has no tool that can measure duration. */
      durationMeasured: false;
      /** Always false. No malware scanner is configured. */
      scanned: false;
    }
  | { ok: false; error: string };

/**
 * Trust the file signature. A declared type is accepted only when it matches that signature.
 * Video duration is not read. A matching signature is not a malware scan and is not a full decode.
 */
export function inspectEvidenceFile(input: { claimedType: string; bytes: Uint8Array }): EvidenceInspection {
  if (input.bytes.byteLength === 0) return { ok: false, error: "The file is empty." };
  const detected = detectEvidenceType(input.bytes);
  if (!detected) {
    return { ok: false, error: "That file is not a supported PDF, JPEG, PNG, WebP, MP4, or WebM document." };
  }
  const claimed = input.claimedType.trim().toLowerCase();
  if (claimed && evidenceExtension(claimed) && claimed !== detected) {
    return { ok: false, error: "The file content does not match its declared type." };
  }
  if (claimed && !evidenceExtension(claimed)) {
    return { ok: false, error: "The file content does not match its declared type." };
  }
  if (!fileStructureLooksIntact(detected, input.bytes)) {
    return { ok: false, error: "That file could not be read. It may be incomplete or corrupted." };
  }
  const limit = evidenceByteLimit(detected);
  if (limit === null || input.bytes.byteLength > limit) {
    return { ok: false, error: sizeMessage(detected) };
  }
  const extension = evidenceExtension(detected);
  if (!extension) return { ok: false, error: "That file is not a supported PDF, JPEG, PNG, WebP, MP4, or WebM document." };
  return {
    ok: true,
    contentType: detected,
    extension,
    byteSize: input.bytes.byteLength,
    durationMeasured: false,
    scanned: false,
  };
}

export function applicantCanAttachEvidence(status: RequestStatus): boolean {
  switch (status) {
    case "draft":
    case "submitted":
    case "under_review":
    case "needs_information":
      return true;
    case "verified":
    case "rejected":
    case "published":
    case "suspended":
    case "closed":
      return false;
    default:
      return assertNever(status);
  }
}

export function campaignCanAttachEvidence(status: CampaignStatus): boolean {
  switch (status) {
    case "draft":
    case "under_review":
      return true;
    case "approved":
    case "scheduled":
    case "active":
    case "closed":
    case "reconciling":
    case "reported":
    case "cancelled":
      return false;
    default:
      return assertNever(status);
  }
}

export function unverifiedEvidenceHold(
  files: readonly { reviewStatus: EvidenceReviewStatus; reviewTracked: boolean }[],
  subject: "request" | "campaign",
): string | null {
  const tracked = files.filter((file) => file.reviewTracked);
  if (tracked.length === 0) return null;
  if (tracked.every((file) => file.reviewStatus === "verified")) return null;
  if (subject === "request") {
    return "This request stays under review until each attached private file is marked verified. A missing video is not itself a reason to reject it.";
  }
  if (subject === "campaign") {
    return "This campaign stays in its current status until each attached private file is marked verified. Uploading a file does not approve the campaign.";
  }
  return assertNever(subject);
}

export function reviewEvidenceDecision(input: {
  actor: Actor;
  ownerId: string;
  next: string;
  note: string;
  contentType: string;
  watcherConfirmed: boolean;
}): { ok: true; status: EvidenceReviewStatus } | { ok: false; error: string } {
  const decision = authorize(input.actor, "request:review", { type: "request", ownerId: input.ownerId });
  if (!decision.allowed) return { ok: false, error: decision.reason };
  const status = EVIDENCE_REVIEW_STATUSES.find((item) => item === input.next) ?? null;
  if (!status) return { ok: false, error: "Choose a review status the workflow allows." };
  if (input.note.trim().length < 8) return { ok: false, error: "Record a reason of at least 8 characters." };
  if (status === "verified" && (input.contentType === "video/mp4" || input.contentType === "video/webm") && !input.watcherConfirmed) {
    return { ok: false, error: "Watch the video before marking it verified. The server did not measure its length." };
  }
  return { ok: true, status };
}

export function evidenceAccessDecision(input: {
  actor: Actor | null;
  ownerId: string;
  audience: "recipient" | "administrator";
}): "allow" | "unauthenticated" | "forbidden" | "hidden" {
  const { actor, audience } = input;
  if (!actor) return audience === "administrator" ? "forbidden" : "unauthenticated";
  if (audience === "administrator") {
    if (!actor.roles.includes("administrator")) return "forbidden";
    if (actor.id === input.ownerId) return "hidden";
    return "allow";
  }
  if (audience === "recipient") {
    if (actor.roles.includes("administrator") && actor.id === input.ownerId) return "hidden";
    if (actor.id !== input.ownerId || !actor.roles.includes("recipient")) return "hidden";
    return "allow";
  }
  return assertNever(audience);
}

export function evidenceDownloadHeaders(fileName: string, contentType: EvidenceContentType): Record<string, string> {
  const name = safeEvidenceLabel(fileName).replace(/["\r\n]/g, "") || "document";
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Frame-Options": "DENY",
  };
}

export function assertEvidenceDescription(value: string): string {
  const description = value.trim();
  if (description.length > MAX_EVIDENCE_DESCRIPTION_CHARS) {
    throw new DomainError("validation", "Shorten the note on that file to 240 characters.");
  }
  return description;
}

export function assertEvidenceGap(value: string): string {
  const gap = value.trim();
  if (gap.length > MAX_EVIDENCE_GAP_CHARS) {
    throw new DomainError("validation", "Shorten the note about the missing document to 500 characters.");
  }
  return gap;
}

function detectEvidenceType(bytes: Uint8Array): EvidenceContentType | null {
  const types = Object.keys(TYPES) as EvidenceContentType[];
  for (const contentType of types) {
    if (evidenceBytesMatch(contentType, bytes)) return contentType;
  }
  return null;
}

function fileStructureLooksIntact(contentType: EvidenceContentType, bytes: Uint8Array): boolean {
  switch (contentType) {
    case "application/pdf":
      return includesAscii(bytes, "%%EOF");
    case "image/jpeg":
      return includesBytes(lastBytes(bytes, 64), [0xff, 0xd9]);
    case "image/png":
      return includesAscii(lastBytes(bytes, 16), "IEND");
    case "image/webp":
      return bytes.byteLength >= 12 && readUint32LE(bytes, 4) === bytes.byteLength - 8;
    case "video/mp4":
    case "video/webm":
      return true;
    default:
      return assertNever(contentType);
  }
}

function sizeMessage(contentType: EvidenceContentType): string {
  switch (contentType) {
    case "image/jpeg":
    case "image/png":
    case "image/webp":
      return "Images must be 10 MB or smaller.";
    case "application/pdf":
      return "PDF files must be 15 MB or smaller.";
    case "video/mp4":
    case "video/webm":
      return "Videos must be 50 MB or smaller.";
    default:
      return assertNever(contentType);
  }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) out += String.fromCharCode(bytes[start + index] ?? 0);
  return out;
}

function includesBytes(bytes: Uint8Array, needle: readonly number[]): boolean {
  if (bytes.byteLength < needle.length) return false;
  for (let index = 0; index <= bytes.byteLength - needle.length; index += 1) {
    let match = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function includesAscii(bytes: Uint8Array, needle: string): boolean {
  if (bytes.byteLength < needle.length) return false;
  const codes = [...needle].map((char) => char.charCodeAt(0));
  for (let index = 0; index <= bytes.byteLength - needle.length; index += 1) {
    let match = true;
    for (let offset = 0; offset < codes.length; offset += 1) {
      if (bytes[index + offset] !== codes[offset]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function lastBytes(bytes: Uint8Array, count: number): Uint8Array {
  return bytes.subarray(Math.max(0, bytes.byteLength - count));
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24);
}

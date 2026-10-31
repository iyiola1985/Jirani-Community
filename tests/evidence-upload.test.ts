import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DEMO_ADMIN_ID, DEMO_DONOR_ID, DEMO_RECIPIENT_ID } from "@/data/demo";
import {
  evidenceAccessDecision,
  evidenceByteLimit,
  evidenceBytesMatch,
  evidenceDownloadHeaders,
  evidenceExtension,
  inspectEvidenceFile,
  isPrivateStorageKey,
  PUBLIC_REQUEST_COLUMNS,
  reviewEvidenceDecision,
  safeEvidenceLabel,
  unattachedStorageKeys,
  unverifiedEvidenceHold,
  applicantCanAttachEvidence,
} from "@/domain/evidence";
import { PUBLIC_COLUMNS } from "@/server/campaigns";
import { writePrivateEvidence, removePrivateEvidence, readPrivateEvidence } from "@/server/evidence-files";

const recipient = { id: DEMO_RECIPIENT_ID, roles: ["recipient"] as const, displayName: "Achieng" };
const donor = { id: DEMO_DONOR_ID, roles: ["donor"] as const, displayName: "Wanjiku" };
const admin = { id: DEMO_ADMIN_ID, roles: ["administrator"] as const, displayName: "Otieno" };

function pdf(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
}

function jpeg(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
}

function png(): Uint8Array {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const iend = [0x49, 0x45, 0x4e, 0x44];
  return Uint8Array.from([...header, ...iend]);
}

function webp(): Uint8Array {
  const bytes = new Uint8Array(12);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes[4] = 4;
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

function mp4(): Uint8Array {
  return Uint8Array.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d,
  ]);
}

function webm(): Uint8Array {
  return Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
}

describe("evidence inspection", () => {
  it("accepts a real PDF, JPEG, PNG, WebP, MP4, and WebM signature", () => {
    expect(inspectEvidenceFile({ claimedType: "application/pdf", bytes: pdf() })).toMatchObject({
      ok: true,
      contentType: "application/pdf",
      durationMeasured: false,
      scanned: false,
    });
    expect(inspectEvidenceFile({ claimedType: "image/jpeg", bytes: jpeg() }).ok).toBe(true);
    expect(inspectEvidenceFile({ claimedType: "image/png", bytes: png() }).ok).toBe(true);
    expect(inspectEvidenceFile({ claimedType: "image/webp", bytes: webp() }).ok).toBe(true);
    expect(inspectEvidenceFile({ claimedType: "video/mp4", bytes: mp4() })).toMatchObject({ ok: true, durationMeasured: false });
    expect(inspectEvidenceFile({ claimedType: "video/webm", bytes: webm() }).ok).toBe(true);
    expect(evidenceExtension("video/mp4")).toBe("mp4");
    expect(evidenceByteLimit("image/jpeg")).toBe(10 * 1024 * 1024);
    expect(evidenceByteLimit("application/pdf")).toBe(15 * 1024 * 1024);
    expect(evidenceByteLimit("video/webm")).toBe(50 * 1024 * 1024);
  });

  it("rejects an empty file, a corrupt image, a spoofed type, and an unsupported file", () => {
    expect(inspectEvidenceFile({ claimedType: "application/pdf", bytes: new Uint8Array() })).toMatchObject({ ok: false, error: "The file is empty." });
    expect(inspectEvidenceFile({ claimedType: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff]) }).ok).toBe(false);
    expect(inspectEvidenceFile({ claimedType: "image/jpeg", bytes: pdf() })).toMatchObject({
      ok: false,
      error: "The file content does not match its declared type.",
    });
    expect(inspectEvidenceFile({ claimedType: "application/x-msdownload", bytes: Uint8Array.from([0x4d, 0x5a, 0x00, 0x00]) }).ok).toBe(false);
    expect(evidenceBytesMatch("application/pdf", Uint8Array.from([0x4d, 0x5a]))).toBe(false);
    expect(evidenceExtension("application/x-msdownload")).toBeNull();
  });

  it("rejects an oversized image without trusting the extension", () => {
    const bytes = jpeg();
    const inflated = new Uint8Array(10 * 1024 * 1024 + 1);
    inflated.set(bytes.subarray(0, 3), 0);
    inflated[inflated.length - 2] = 0xff;
    inflated[inflated.length - 1] = 0xd9;
    const result = inspectEvidenceFile({ claimedType: "image/jpeg", bytes: inflated });
    expect(result).toMatchObject({ ok: false, error: "Images must be 10 MB or smaller." });
  });

  it("keeps the original name out of the storage key and refuses traversal", () => {
    expect(safeEvidenceLabel("../../secret.exe")).toBe("secret.exe");
    expect(safeEvidenceLabel("..\\..\\hospital.pdf")).toBe("hospital.pdf");
    expect(isPrivateStorageKey("../etc/passwd")).toBe(false);
    expect(isPrivateStorageKey("not-a-uuid.pdf")).toBe(false);
    expect(isPrivateStorageKey("11111111-1111-4111-8111-111111111111.pdf")).toBe(true);
    expect(unattachedStorageKeys(["11111111-1111-4111-8111-111111111111.pdf"], true)).toEqual([]);
    expect(unattachedStorageKeys(["../etc/passwd", "11111111-1111-4111-8111-111111111111.pdf"], false)).toEqual([
      "11111111-1111-4111-8111-111111111111.pdf",
    ]);
  });

  it("serves evidence as a download and hides it from the public field lists", () => {
    const headers = evidenceDownloadHeaders("../../bill.pdf", "application/pdf");
    expect(headers["Content-Disposition"]).toBe('attachment; filename="bill.pdf"');
    expect(headers["Content-Disposition"]).not.toContain("..");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(PUBLIC_REQUEST_COLUMNS).not.toMatch(/storage_key|private_evidence|situation_notes|evidence_gap/);
    expect(PUBLIC_COLUMNS).not.toMatch(/storage_key|private_evidence|situation_notes|review_note/);
  });

  it("stops an applicant, a donor, and the owner-administrator from private evidence decisions", () => {
    expect(evidenceAccessDecision({ actor: null, ownerId: recipient.id, audience: "recipient" })).toBe("unauthenticated");
    expect(evidenceAccessDecision({ actor: null, ownerId: recipient.id, audience: "administrator" })).toBe("forbidden");
    expect(evidenceAccessDecision({ actor: donor, ownerId: recipient.id, audience: "administrator" })).toBe("forbidden");
    expect(evidenceAccessDecision({ actor: donor, ownerId: recipient.id, audience: "recipient" })).toBe("hidden");
    expect(evidenceAccessDecision({ actor: recipient, ownerId: DEMO_ADMIN_ID, audience: "recipient" })).toBe("hidden");
    expect(evidenceAccessDecision({ actor: admin, ownerId: admin.id, audience: "administrator" })).toBe("hidden");
    expect(evidenceAccessDecision({ actor: admin, ownerId: recipient.id, audience: "administrator" })).toBe("allow");
    expect(reviewEvidenceDecision({
      actor: recipient,
      ownerId: recipient.id,
      next: "verified",
      note: "I approve my own file",
      contentType: "application/pdf",
      watcherConfirmed: false,
    }).ok).toBe(false);
    expect(reviewEvidenceDecision({
      actor: admin,
      ownerId: admin.id,
      next: "verified",
      note: "Checked the bill",
      contentType: "application/pdf",
      watcherConfirmed: false,
    }).ok).toBe(false);
    const video = reviewEvidenceDecision({
      actor: admin,
      ownerId: recipient.id,
      next: "verified",
      note: "I watched the clip",
      contentType: "video/mp4",
      watcherConfirmed: false,
    });
    expect(video.ok).toBe(false);
    expect(reviewEvidenceDecision({
      actor: admin,
      ownerId: recipient.id,
      next: "needs_clarification",
      note: "Please add the discharge note",
      contentType: "video/mp4",
      watcherConfirmed: false,
    })).toMatchObject({ ok: true, status: "needs_clarification" });
  });

  it("does not reject an application only because video is missing", () => {
    expect(unverifiedEvidenceHold([], "campaign")).toBeNull();
    expect(unverifiedEvidenceHold([{ reviewStatus: "pending_review", reviewTracked: false }], "request")).toBeNull();
    expect(unverifiedEvidenceHold([{ reviewStatus: "pending_review", reviewTracked: true }], "campaign")).toMatch(/does not approve/);
    expect(unverifiedEvidenceHold([{ reviewStatus: "verified", reviewTracked: true }], "request")).toBeNull();
    expect(applicantCanAttachEvidence("needs_information")).toBe(true);
    expect(applicantCanAttachEvidence("published")).toBe(false);
  });
});

describe("private evidence files", () => {
  it("stores a generated name and does not delete a key that is already attached", async () => {
    const key = await writePrivateEvidence("application/pdf", pdf());
    expect(key).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(key).not.toContain("secret");
    const full = path.resolve(process.cwd(), "storage/private-evidence", key);
    const stored = await readFile(full);
    expect(stored.subarray(0, 4).toString()).toBe("%PDF");
    await expect(readPrivateEvidence("../etc/passwd")).rejects.toThrow(/Unexpected evidence file name/);
    expect(unattachedStorageKeys([key], true)).toEqual([]);
    await removePrivateEvidence(key);
    await rm(full, { force: true });
  });
});

import { describe, expect, it } from "vitest";

import { evidenceBytesMatch, evidenceExtension, safeEvidenceLabel } from "@/domain/evidence";
import { transitionRequest } from "@/domain/requests";
import { toPublicRequest } from "@/domain/access";
import type { Actor, RequestRecord } from "@/domain/types";
import { submissionIntent, validateRequestForm } from "@/domain/validation";
import { COUNTIES } from "@/data/counties";

const counties = COUNTIES;

const base = {
  category: "food",
  title: "Food for a household in Kisumu",
  summary: "Help with a basic food shop for a household in Kisumu County. The public text names the county only.",
  county: "Kisumu",
  amountShillings: "1500",
  publicAlias: "Neighbour in Kisumu",
  privateNotes: "Call the reviewer, not the public page.",
  acceptedPublication: true,
  accurate: true,
  understandsVerification: true,
  understandsNoGuarantee: true,
  understandsPrivate: true,
  acceptedPrivacy: true,
  locality: "Kisumu town",
  reason: "The household has no food for the week.",
  preferredAssistance: "food",
  urgent: false,
};

const owner: Actor = { id: "owner", roles: ["recipient"], displayName: "Owner" };
const admin: Actor = { id: "admin", roles: ["administrator"], displayName: "Admin" };

function record(status: RequestRecord["status"]): RequestRecord {
  return {
    id: "request",
    ownerId: owner.id,
    publicAlias: "Neighbour",
    category: "food",
    title: "Food for a household in Kisumu",
    summary: base.summary,
    county: "Kisumu",
    amountNeededMinor: 150_000,
    currency: "KES",
    status,
    privateNotes: "",
    demo: false,
    flags: [],
    createdAt: "2026-10-28T00:00:00.000Z",
  };
}

describe("assistance applications", () => {
  it("saves a draft without the submission confirmations", () => {
    const parsed = validateRequestForm({ ...base, mode: "draft", accurate: false, acceptedPublication: false }, counties);
    expect(parsed.ok).toBe(true);
  });

  it("requires the submission confirmations and a whole-shilling amount", () => {
    const missing = validateRequestForm({ ...base, accurate: false }, counties);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.accurate).toBeTruthy();
    const amount = validateRequestForm({ ...base, amountShillings: "99.5" }, counties);
    expect(amount.ok).toBe(false);
    if (!amount.ok) expect(amount.errors.amountShillings).toBeTruthy();
  });

  it("rejects a street address in the public area", () => {
    const parsed = validateRequestForm({ ...base, locality: "Plot 12" }, counties);
    expect(parsed.ok).toBe(false);
  });

  it("treats a second submit as a duplicate and a draft as editable", () => {
    expect(submissionIntent(null, "draft")).toBe("insert");
    expect(submissionIntent("draft", "submit")).toBe("update");
    expect(submissionIntent("needs_information", "submit")).toBe("update");
    expect(submissionIntent("submitted", "submit")).toBe("duplicate");
    expect(submissionIntent("published", "draft")).toBe("duplicate");
  });

  it("hides unpublished requests from the public projection", () => {
    expect(toPublicRequest(record("submitted"), 0)).toBeNull();
    expect(toPublicRequest(record("published"), 500)?.raisedMinor).toBe(500);
  });

  it("stops an applicant publishing their own request and ignores a repeated transition", () => {
    expect(() => transitionRequest({
      request: record("verified"),
      to: "published",
      actor: owner,
      reason: "I approve my own request",
      ownerVerificationStatus: "verified",
      now: "2026-10-28T00:00:00.000Z",
    })).toThrow(/administrator|cannot/i);
    expect(() => transitionRequest({
      request: record("published"),
      to: "published",
      actor: admin,
      reason: "Publish it again now",
      ownerVerificationStatus: "verified",
      now: "2026-10-28T00:00:00.000Z",
    })).toThrow(/cannot move/i);
  });

  it("rejects an unexpected evidence file", () => {
    expect(evidenceExtension("application/x-msdownload")).toBeNull();
    expect(evidenceExtension("application/pdf")).toBe("pdf");
    expect(evidenceBytesMatch("application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(true);
    expect(evidenceBytesMatch("application/pdf", new Uint8Array([0x4d, 0x5a]))).toBe(false);
    expect(safeEvidenceLabel("../../secret.exe")).toBe("secret.exe");
  });
});

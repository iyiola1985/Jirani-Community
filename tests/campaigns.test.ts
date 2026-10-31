import { describe, expect, it } from "vitest";

import { validateCampaignDraft } from "@/domain/campaign-form";
import { allowedCampaignTransitions, transitionCampaign } from "@/domain/campaigns";
import { DomainError } from "@/domain/errors";
import type { Actor, CampaignRecord } from "@/domain/types";

const admin: Actor = {
  id: "33333333-3333-4333-8333-333333333333",
  roles: ["administrator"],
  displayName: "Admin",
};

const draft = (): CampaignRecord => ({
  id: "campaign-1",
  title: "School fees in Kisumu",
  objective: "Pool gifts for reviewed school-fee needs in Kisumu during this month.",
  targetMinor: 500_000,
  currency: "KES",
  startsAt: "2026-12-01T00:00:00.000Z",
  endsAt: "2026-12-20T00:00:00.000Z",
  eligibilityCriteria: "Reviewed education requests in Kisumu with a remaining gap.",
  beneficiarySelectionRules: "An administrator records one manual decision against the published rules.",
  feeDisclosure: "The platform fee is KSh 0.",
  refundPolicy: "A reversal is a new ledger row.",
  surplusPolicy: "Surplus stays with this campaign until reconciliation.",
  status: "draft",
  demo: false,
});

const valid = {
  title: "School fees in Kisumu",
  slug: "school-fees-kisumu",
  category: "school",
  objective: "Pool gifts for reviewed school-fee needs in Kisumu during this month.",
  amountShillings: "5000",
  startsAt: "2026-12-01T09:00",
  endsAt: "2026-12-20T18:00",
  county: "Kisumu",
  beneficiaryGroup: "Households in Kisumu",
  eligibilityCriteria: "Reviewed education requests in Kisumu with a remaining gap and a published summary.",
  selectionRules: "An administrator records one manual decision against the published rules. There is no silent redraw.",
  feeDisclosure: "The platform fee for this campaign is KSh 0.",
  refundPolicy: "A reversal is recorded as a new ledger row and the original gift stays.",
  surplusPolicy: "Surplus stays with this campaign until a reviewed allocation. It is not moved elsewhere.",
  cancellationAllowed: false,
};

describe("campaign form validation", () => {
  it("accepts a complete draft and stores the target in cents", () => {
    const parsed = validateCampaignDraft(valid);
    expect(parsed.targetMinor).toBe(500_000);
    expect(parsed.slug).toBe("school-fees-kisumu");
    expect(parsed.startsAt.endsWith("Z")).toBe(true);
  });

  it("rejects a short title, a negative target, a bad county, and a closing date that is not later", () => {
    expect(() => validateCampaignDraft({ ...valid, title: "Fees" })).toThrow(DomainError);
    expect(() => validateCampaignDraft({ ...valid, amountShillings: "-100" })).toThrow(DomainError);
    expect(() => validateCampaignDraft({ ...valid, amountShillings: "50" })).toThrow(DomainError);
    expect(() => validateCampaignDraft({ ...valid, county: "Atlantis" })).toThrow(DomainError);
    expect(() => validateCampaignDraft({ ...valid, endsAt: "2026-11-01T09:00" })).toThrow(/closing date/i);
    expect(() => validateCampaignDraft({ ...valid, eligibilityCriteria: "Too short" })).toThrow(/eligibility/i);
  });
});

describe("campaign lifecycle", () => {
  it("keeps publication behind review and does not disburse on close", () => {
    expect(allowedCampaignTransitions("draft")).toEqual(["under_review", "cancelled"]);
    expect(allowedCampaignTransitions("approved")).toContain("scheduled");
    expect(allowedCampaignTransitions("approved")).toContain("active");
    expect(() =>
      transitionCampaign({ campaign: draft(), to: "scheduled", actor: admin, reason: "Open it now." }),
    ).toThrow(/cannot move/i);
    const closed = transitionCampaign({
      campaign: { ...draft(), status: "active" },
      to: "closed",
      actor: admin,
      reason: "The closing date has passed.",
    });
    expect(closed.status).toBe("closed");
  });
});

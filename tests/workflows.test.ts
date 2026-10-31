import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { AssistanceBook, type BookSeed } from "@/domain/book";
import { INACTIVE_DEMO_FEE_RULE } from "@/domain/fees";
import { MockPaymentProvider, statusAfterBrowserReturn } from "@/domain/payments";
import type { Actor, CampaignRecord, FeeRule } from "@/domain/types";

const SECRET = "test-provider-secret";

const recipient: Actor = {
  id: "11111111-1111-4111-8111-111111111111",
  roles: ["recipient"],
  displayName: "Recipient",
};
const donor: Actor = {
  id: "22222222-2222-4222-8222-222222222222",
  roles: ["donor"],
  displayName: "Donor",
};
const admin: Actor = {
  id: "33333333-3333-4333-8333-333333333333",
  roles: ["administrator"],
  displayName: "Admin",
};
const other: Actor = {
  id: "44444444-4444-4444-8444-444444444444",
  roles: ["recipient"],
  displayName: "Other",
};

function seed(extra?: Partial<BookSeed> & { feeRules?: FeeRule[] }): BookSeed {
  return {
    requests: [],
    campaigns: [],
    contributions: [],
    refunds: [],
    disbursements: [],
    reports: [],
    allocations: [],
    evidence: [],
    verifications: [
      { profileId: recipient.id, status: "verified", legalName: "Test Recipient" },
      { profileId: other.id, status: "verified", legalName: "Other Recipient" },
    ],
    consents: [],
    complaints: [],
    audit: [],
    feeRules: [INACTIVE_DEMO_FEE_RULE],
    ...extra,
  };
}

function book(extra?: Partial<BookSeed>): AssistanceBook {
  return AssistanceBook.fromSeed(seed(extra), SECRET);
}

const campaign = (status: CampaignRecord["status"]): CampaignRecord => ({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  title: "Test campaign",
  objective: "Fund a defined community kitchen.",
  targetMinor: 500_000,
  currency: "KES",
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-11-30T00:00:00.000Z",
  eligibilityCriteria: "Verified requests only.",
  beneficiarySelectionRules: "Allocations record a written reason. There is no random draw.",
  feeDisclosure: "No fee is collected in this test.",
  refundPolicy: "Refunds are new ledger entries.",
  surplusPolicy: "Closure does not send money.",
  status,
  demo: true,
});

describe("requests, evidence, and audit", () => {
  it("submits a request, flags a high amount, and does not auto-reject it", () => {
    const result = book().submitRequest({
      actor: recipient,
      request: {
        publicAlias: "Neighbour",
        category: "rent",
        title: "Rent support in Kisumu County",
        summary: "Help with rent for a household in Kisumu County. The estate name stays in the private note for the reviewer.",
        county: "Kisumu",
        amountNeededMinor: 20_000_000,
        privateNotes: "Private follow-up.",
        demo: true,
      },
    });
    expect(result.request.status).toBe("submitted");
    expect(result.request.flags).toContain("high_amount");
    expect(result.audit.some((entry) => entry.action === "suspicious_activity_flagged")).toBe(true);
    expect(result.audit.some((entry) => entry.action === "request.rejected")).toBe(false);
  });

  it("walks the verification workflow and blocks self-approval", () => {
    const ledger = book();
    const submitted = ledger.submitRequest({
      actor: recipient,
      request: {
        publicAlias: "Neighbour",
        category: "food",
        title: "Food support in Kisumu County",
        summary: "Help with a basic food shop for a household in Kisumu County. The public text names the county only.",
        county: "Kisumu",
        amountNeededMinor: 200_000,
        privateNotes: "Private note",
        demo: true,
      },
    });
    const ownerAdmin: Actor = { ...admin, id: recipient.id, roles: ["administrator", "recipient"] };
    expect(() =>
      ledger.reviewRequest({
        actor: ownerAdmin,
        requestId: submitted.request.id,
        to: "under_review",
        reason: "Trying to review my own request.",
      }),
    ).toThrow(/own assistance request/);

    const reviewing = ledger.reviewRequest({
      actor: admin,
      requestId: submitted.request.id,
      to: "under_review",
      reason: "Opened for review.",
    });
    expect(reviewing.audit.action).toBe("request.under_review");
    const verified = ledger.reviewRequest({
      actor: admin,
      requestId: submitted.request.id,
      to: "verified",
      reason: "Identity record and story agree.",
    });
    expect(verified.request.status).toBe("verified");
    const published = ledger.reviewRequest({
      actor: admin,
      requestId: submitted.request.id,
      to: "published",
      reason: "Safe to publish with the alias.",
    });
    expect(published.request.status).toBe("published");
    expect(ledger.listAudit(admin).length).toBeGreaterThan(0);
  });

  it("hides private notes and evidence from the public and from donors", () => {
    const ledger = book();
    const submitted = ledger.submitRequest({
      actor: recipient,
      request: {
        publicAlias: "Neighbour",
        category: "medical",
        title: "Hospital bill in Mombasa County",
        summary: "Support toward a hospital bill in Mombasa County. Clinical details stay in the private note for the reviewer.",
        county: "Mombasa",
        amountNeededMinor: 300_000,
        privateNotes: "Private clinical demonstration note 0700 000 000",
        demo: true,
      },
    });
    ledger.addEvidenceMetadata({
      actor: recipient,
      requestId: submitted.request.id,
      fileName: "demo-letter.pdf",
      contentType: "application/pdf",
      byteSize: 1000,
      sha256: "abc",
    });
    expect(() => ledger.readEvidence(donor, submitted.request.id)).toThrow(/Private evidence/);
    expect(() => ledger.readEvidence(other, submitted.request.id)).toThrow(/own request|Private evidence/);
    expect(ledger.readEvidence(recipient, submitted.request.id)).toHaveLength(1);
    expect(ledger.readEvidence(admin, submitted.request.id)[0]?.storageKey).toBeNull();

    ledger.reviewRequest({ actor: admin, requestId: submitted.request.id, to: "under_review", reason: "Reviewing now." });
    ledger.reviewRequest({ actor: admin, requestId: submitted.request.id, to: "verified", reason: "Verified identity." });
    ledger.reviewRequest({ actor: admin, requestId: submitted.request.id, to: "published", reason: "Publish the alias." });
    const published = JSON.stringify(ledger.getPublicRequest(submitted.request.id));
    expect(published).not.toContain("0700");
    expect(published).not.toContain("clinical demonstration");
    expect(published).not.toContain("demo-letter.pdf");
  });
});

describe("payments", () => {
  async function publishedBook(): Promise<{ ledger: AssistanceBook; requestId: string }> {
    const ledger = book();
    const submitted = ledger.submitRequest({
      actor: recipient,
      request: {
        publicAlias: "Neighbour",
        category: "food",
        title: "Food support in Kisumu County",
        summary: "Help with a basic food shop for a household in Kisumu County. The public text names the county only.",
        county: "Kisumu",
        amountNeededMinor: 500_000,
        privateNotes: "",
        demo: true,
      },
    });
    ledger.reviewRequest({ actor: admin, requestId: submitted.request.id, to: "under_review", reason: "Reviewing now." });
    ledger.reviewRequest({ actor: admin, requestId: submitted.request.id, to: "verified", reason: "Verified identity." });
    ledger.reviewRequest({ actor: admin, requestId: submitted.request.id, to: "published", reason: "Publish the alias." });
    return { ledger, requestId: submitted.request.id };
  }

  it("ignores a browser success claim until the provider confirms it", async () => {
    const { ledger, requestId } = await publishedBook();
    const contribution = ledger.startContribution({
      actor: donor,
      requestId,
      giftMinor: 100_000,
      recognition: "anonymous",
      idempotencyKey: "gift-1",
    });
    expect(contribution.simulated).toBe(true);
    expect(ledger.readReturn(contribution.id, "successful")).toBe("pending");
    expect(ledger.readContribution(donor, contribution.id).status).toBe("pending");
    expect(statusAfterBrowserReturn("successful", "pending")).toBe("pending");
  });

  it("accepts one signed callback and ignores the duplicate", async () => {
    const { ledger, requestId } = await publishedBook();
    const contribution = ledger.startContribution({
      actor: donor,
      requestId,
      giftMinor: 100_000,
      recognition: "public",
      publicName: "Wanjiku",
      idempotencyKey: "gift-2",
    });
    const providerEventId = randomUUID();
    const payload = {
      providerEventId,
      providerReference: contribution.providerReference,
      reportedStatus: "successful" as const,
      amountMinor: contribution.donorPaysMinor,
    };
    const first = ledger.applyProviderCallback({ ...payload, signature: ledger.signSimulation(payload) });
    const second = ledger.applyProviderCallback({ ...payload, signature: ledger.signSimulation(payload) });
    expect(first.duplicate).toBe(false);
    expect(first.contribution.status).toBe("successful");
    expect(first.contribution.receiptNumber).toMatch(/^SIM-/);
    expect(second.duplicate).toBe(true);
    expect(ledger.raisedMinor(requestId)).toBe(100_000);
    expect(ledger.platformRevenueFromLedger()).toBe(0);
  });

  it("records a failed payment without a gift entry", async () => {
    const { ledger, requestId } = await publishedBook();
    const contribution = ledger.startContribution({
      actor: donor,
      requestId,
      giftMinor: 100_000,
      recognition: "anonymous",
      idempotencyKey: "gift-3",
    });
    const payload = {
      providerEventId: randomUUID(),
      providerReference: contribution.providerReference,
      reportedStatus: "failed" as const,
      amountMinor: contribution.donorPaysMinor,
    };
    const result = ledger.applyProviderCallback({ ...payload, signature: ledger.signSimulation(payload) });
    expect(result.contribution.status).toBe("failed");
    expect(ledger.raisedMinor(requestId)).toBe(0);
  });

  it("refunds with a reversal entry and leaves the original gift unchanged", async () => {
    const { ledger, requestId } = await publishedBook();
    const contribution = ledger.startContribution({
      actor: donor,
      requestId,
      giftMinor: 150_000,
      recognition: "anonymous",
      idempotencyKey: "gift-4",
    });
    const payload = {
      providerEventId: randomUUID(),
      providerReference: contribution.providerReference,
      reportedStatus: "successful" as const,
      amountMinor: contribution.donorPaysMinor,
    };
    ledger.applyProviderCallback({ ...payload, signature: ledger.signSimulation(payload) });
    const originalGift = contribution.giftMinor;
    const refunded = ledger.refundContribution({
      actor: admin,
      contributionId: contribution.id,
      amountMinor: originalGift,
      reason: "Demonstration reversal of a simulated gift.",
      idempotencyKey: "refund-1",
    });
    expect(refunded.contribution.giftMinor).toBe(originalGift);
    expect(refunded.contribution.status).toBe("reversed");
    expect(refunded.refund.simulated).toBe(true);
    expect(ledger.raisedMinor(requestId)).toBe(0);
    const giftEntry = ledger.listLedger(admin).find((entry) => entry.kind === "gift");
    expect(giftEntry?.amountMinor).toBe(originalGift);
    expect(ledger.listLedger(admin).some((entry) => entry.kind === "refund")).toBe(true);
    expect(() =>
      ledger.refundContribution({
        actor: donor,
        contributionId: contribution.id,
        amountMinor: 100,
        reason: "Donors cannot reverse gifts.",
        idempotencyKey: "refund-2",
      }),
    ).toThrow(/administrator/);
  });

  it("reuses an idempotency key instead of creating a second payment", async () => {
    const provider = new MockPaymentProvider(SECRET);
    const first = provider.initiate({
      idempotencyKey: "same",
      amountMinor: 10_000,
      currency: "KES",
      clientReference: "one",
    });
    const second = provider.initiate({
      idempotencyKey: "same",
      amountMinor: 10_000,
      currency: "KES",
      clientReference: "one",
    });
    expect(second.duplicate).toBe(true);
    expect(second.init.providerReference).toBe(first.init.providerReference);
    const event = {
      providerEventId: "event-1",
      providerReference: first.init.providerReference,
      reportedStatus: "successful" as const,
      amountMinor: 10_000,
    };
    const signed = { ...event, signature: provider.signCallback(event) };
    expect(provider.handleCallback(signed).duplicate).toBe(false);
    expect(provider.handleCallback(signed).duplicate).toBe(true);
    expect(provider.handleCallback({ ...signed, signature: "00" }).accepted).toBe(false);
  });
});

describe("campaign closure and disbursement", () => {
  it("closes without sending money, then records a separate approval", () => {
    const ledger = book({ campaigns: [campaign("active")] });
    const contribution = ledger.startContribution({
      actor: donor,
      campaignId: campaign("active").id,
      giftMinor: 200_000,
      recognition: "anonymous",
      idempotencyKey: "campaign-gift",
    });
    const payload = {
      providerEventId: randomUUID(),
      providerReference: contribution.providerReference,
      reportedStatus: "successful" as const,
      amountMinor: contribution.donorPaysMinor,
    };
    ledger.applyProviderCallback({ ...payload, signature: ledger.signSimulation(payload) });
    expect(() =>
      ledger.approveDisbursement({
        actor: admin,
        campaignId: campaign("active").id,
        beneficiaryOwnerId: other.id,
        amountMinor: 200_000,
        reason: "Too early to approve.",
      }),
    ).toThrow(/does not send money/);

    const closed = ledger.closeCampaign(admin, campaign("active").id, "End date reached.");
    expect(closed.disbursementsCreated).toBe(0);
    expect(closed.campaign.status).toBe("closed");
    expect(ledger.listDisbursements(admin)).toHaveLength(0);

    ledger.startReconciliation(admin, campaign("active").id, "Checked the simulated gifts.");
    const approval = ledger.approveDisbursement({
      actor: admin,
      campaignId: campaign("active").id,
      beneficiaryOwnerId: other.id,
      amountMinor: 200_000,
      reason: "Matches the written kitchen plan.",
    });
    expect(approval.disbursement.fundsSent).toBe(false);
    expect(approval.disbursement.providerTransferReference).toBeNull();
    expect(approval.audit.action).toBe("disbursement.approved");
    expect(() =>
      ledger.approveDisbursement({
        actor: admin,
        campaignId: campaign("active").id,
        beneficiaryOwnerId: admin.id,
        amountMinor: 100,
        reason: "Paying myself is not allowed.",
      }),
    ).toThrow(/yourself/);

    const totals = ledger.totalsFor(campaign("active").id);
    expect(totals.successfulGiftMinor).toBe(200_000);
    expect(totals.platformRevenueMinor).toBe(0);
    expect(totals.platformRevenueMinor).not.toBe(totals.successfulGiftMinor);
    const report = ledger.publishReport(
      admin,
      campaign("active").id,
      "Simulated gifts were reconciled and an approval was recorded. No transfer was sent.",
    );
    expect(report.report.grossGiftMinor).toBe(200_000);
    expect(report.report.platformFeeMinor).toBe(0);
  });
});

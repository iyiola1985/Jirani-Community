import { assertNever } from "@/domain/assert-never";
import { DomainError } from "@/domain/errors";
import { assertMinor } from "@/domain/money";
import { assertAllowed } from "@/domain/permissions";
import type {
  Actor,
  CampaignRecord,
  CampaignStatus,
  Contribution,
  Disbursement,
  RefundRecord,
} from "@/domain/types";

const ALLOWED: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["under_review", "cancelled"],
  under_review: ["approved", "draft", "cancelled"],
  approved: ["scheduled", "active", "cancelled"],
  scheduled: ["active", "cancelled"],
  active: ["closed", "cancelled"],
  closed: ["reconciling"],
  reconciling: ["reported"],
  reported: [],
  cancelled: [],
};

export function allowedCampaignTransitions(from: CampaignStatus): readonly CampaignStatus[] {
  switch (from) {
    case "draft":
    case "under_review":
    case "approved":
    case "scheduled":
    case "active":
    case "closed":
    case "reconciling":
    case "reported":
    case "cancelled":
      return ALLOWED[from];
    default:
      return assertNever(from);
  }
}

export function transitionCampaign(input: {
  campaign: CampaignRecord;
  to: CampaignStatus;
  actor: Actor;
  reason: string;
}): CampaignRecord {
  if (input.reason.trim().length < 8) {
    throw new DomainError("reason_required", "Record a reason of at least 8 characters.");
  }
  assertAllowed(input.actor, "campaign:manage");
  if (!allowedCampaignTransitions(input.campaign.status).includes(input.to)) {
    throw new DomainError(
      "campaign_transition",
      `A campaign cannot move from ${input.campaign.status} to ${input.to}.`,
    );
  }
  return { ...input.campaign, status: input.to };
}

export type CampaignTotals = {
  currency: "KES";
  successfulGiftMinor: number;
  refundedMinor: number;
  netGiftMinor: number;
  platformFeeCollectedMinor: number;
  providerFeeMinor: number;
  pendingMinor: number;
  failedCount: number;
  disbursementApprovedMinor: number;
  /** Platform revenue is fee entries only. Gifts are not added into it. */
  platformRevenueMinor: number;
};

export function campaignTotals(input: {
  campaignId: string;
  contributions: readonly Contribution[];
  refunds: readonly RefundRecord[];
  disbursements: readonly Disbursement[];
}): CampaignTotals {
  const mine = input.contributions.filter((item) => item.campaignId === input.campaignId);
  const ids = new Set(mine.map((item) => item.id));
  let successfulGiftMinor = 0;
  let platformFeeCollectedMinor = 0;
  let campaignBorneFeeMinor = 0;
  let providerFeeMinor = 0;
  let pendingMinor = 0;
  let failedCount = 0;
  for (const contribution of mine) {
    switch (contribution.status) {
      case "successful":
      case "reversed":
        successfulGiftMinor += contribution.giftMinor;
        platformFeeCollectedMinor += contribution.collectedPlatformFeeMinor + contribution.campaignBorneFeeMinor;
        campaignBorneFeeMinor += contribution.campaignBorneFeeMinor;
        providerFeeMinor += contribution.providerFeeMinor;
        break;
      case "pending":
        pendingMinor += contribution.giftMinor;
        break;
      case "failed":
        failedCount += 1;
        break;
      default:
        assertNever(contribution.status);
    }
  }
  const refundedMinor = input.refunds
    .filter((refund) => ids.has(refund.contributionId))
    .reduce((sum, refund) => sum + refund.amountMinor, 0);
  const disbursementApprovedMinor = input.disbursements
    .filter((item) => item.campaignId === input.campaignId && item.status === "approved")
    .reduce((sum, item) => sum + item.amountMinor, 0);
  return {
    currency: "KES",
    successfulGiftMinor,
    refundedMinor,
    netGiftMinor: successfulGiftMinor - campaignBorneFeeMinor - refundedMinor,
    platformFeeCollectedMinor,
    providerFeeMinor,
    pendingMinor,
    failedCount,
    disbursementApprovedMinor,
    platformRevenueMinor: platformFeeCollectedMinor,
  };
}

export function assertDisbursementAllowed(input: {
  campaign: CampaignRecord;
  amountMinor: number;
  actor: Actor;
  beneficiaryOwnerId: string | null;
}): void {
  assertMinor(input.amountMinor, "Disbursement");
  if (input.amountMinor === 0) {
    throw new DomainError("disbursement", "A disbursement needs an amount.");
  }
  assertAllowed(input.actor, "disbursement:approve", {
    type: "disbursement",
    beneficiaryOwnerId: input.beneficiaryOwnerId,
  });
  if (input.campaign.status !== "closed" && input.campaign.status !== "reconciling") {
    throw new DomainError(
      "disbursement",
      "Close the campaign and start reconciliation before approving a disbursement. Closure itself does not send money.",
    );
  }
}

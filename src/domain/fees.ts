import { DomainError } from "@/domain/errors";
import { assertMinor, divRoundHalfUp } from "@/domain/money";
import type { FeePayer, FeeRule } from "@/domain/types";

export type FeeQuote = {
  currency: "KES";
  giftMinor: number;
  ruleId: string | null;
  ruleName: string | null;
  payer: FeePayer | "none";
  /** What the rule's rate would calculate, whether or not it is collected. */
  platformFeeMinor: number;
  collectedPlatformFeeMinor: number;
  campaignBorneFeeMinor: number;
  providerFeeMinor: number;
  donorPaysMinor: number;
  netToCauseMinor: number;
  collectionActive: boolean;
  disclosed: true;
  summary: string;
};

export const INACTIVE_DEMO_FEE_RULE: FeeRule = {
  id: "00000000-0000-4000-8000-0000000000f1",
  name: "Inactive demonstration rule",
  appliesTo: "campaign",
  campaignType: null,
  rateBps: 0,
  fixedMinor: 0,
  payer: "platform_absorbed",
  active: false,
  demoOnly: true,
};

/** Shown on the fees page as arithmetic. Checkout never loads this rule as chargeable. */
export const WORKED_EXAMPLE_FEE_RULE: FeeRule = {
  id: "00000000-0000-4000-8000-0000000000f2",
  name: "Worked example: 2.5% added for the donor",
  appliesTo: "campaign",
  campaignType: "community",
  rateBps: 250,
  fixedMinor: null,
  payer: "donor",
  active: false,
  demoOnly: true,
};

export function getChargeableFeeRule(rules: readonly FeeRule[]): FeeRule | null {
  const chargeable = rules.filter((rule) => rule.active && !rule.demoOnly);
  if (chargeable.length > 1) {
    throw new DomainError("fee_config", "More than one chargeable fee rule is active.");
  }
  return chargeable[0] ?? null;
}

export function calculateRuleFeeMinor(giftMinor: number, rule: FeeRule): number {
  assertMinor(giftMinor, "Gift");
  if (rule.rateBps == null && rule.fixedMinor == null) {
    throw new DomainError("fee_config", "A fee rule needs a rate or a fixed amount.");
  }
  if (rule.rateBps != null && (!Number.isInteger(rule.rateBps) || rule.rateBps < 0 || rule.rateBps > 10_000)) {
    throw new DomainError("fee_config", "Fee rate must be between 0 and 10000 basis points.");
  }
  if (rule.fixedMinor != null) assertMinor(rule.fixedMinor, "Fixed fee");
  const percentage = rule.rateBps == null ? 0 : divRoundHalfUp(giftMinor * rule.rateBps, 10_000);
  const fixed = rule.fixedMinor ?? 0;
  const total = percentage + fixed;
  assertMinor(total, "Platform fee");
  return total;
}

export function quoteFee(input: {
  giftMinor: number;
  rule: FeeRule | null;
  providerFeeMinor?: number;
  optionalDonorFeeMinor?: number;
}): FeeQuote {
  assertMinor(input.giftMinor, "Gift");
  const providerFeeMinor = input.providerFeeMinor ?? 0;
  assertMinor(providerFeeMinor, "Provider fee");
  const optionalDonorFeeMinor = input.optionalDonorFeeMinor ?? 0;
  assertMinor(optionalDonorFeeMinor, "Optional contribution");

  const rule = input.rule;
  const platformFeeMinor = rule ? calculateRuleFeeMinor(input.giftMinor, rule) : 0;
  const collectionActive = Boolean(rule && rule.active && !rule.demoOnly);

  if (!collectionActive && optionalDonorFeeMinor > 0) {
    throw new DomainError("fee_config", "An optional platform contribution needs an active fee rule.");
  }
  if (collectionActive && rule && rule.payer !== "optional_donor" && optionalDonorFeeMinor > 0) {
    throw new DomainError("fee_config", "This fee rule does not accept an optional extra amount.");
  }

  let collectedPlatformFeeMinor = 0;
  let campaignBorneFeeMinor = 0;
  if (collectionActive && rule) {
    switch (rule.payer) {
      case "donor":
        collectedPlatformFeeMinor = platformFeeMinor;
        break;
      case "optional_donor":
        if (optionalDonorFeeMinor > platformFeeMinor) {
          throw new DomainError("fee_config", "The optional contribution is above the disclosed fee.");
        }
        collectedPlatformFeeMinor = optionalDonorFeeMinor;
        break;
      case "campaign":
        campaignBorneFeeMinor = platformFeeMinor;
        break;
      case "platform_absorbed":
        break;
      default: {
        const _exhaustive: never = rule.payer;
        throw new DomainError("fee_config", `Unknown fee payer ${String(_exhaustive)}.`);
      }
    }
  }

  const netToCauseMinor = input.giftMinor - campaignBorneFeeMinor;
  if (netToCauseMinor < 0) {
    throw new DomainError("fee_config", "The fee would be larger than the gift.");
  }

  return {
    currency: "KES",
    giftMinor: input.giftMinor,
    ruleId: rule?.id ?? null,
    ruleName: rule?.name ?? null,
    payer: collectionActive && rule ? rule.payer : "none",
    platformFeeMinor,
    collectedPlatformFeeMinor,
    campaignBorneFeeMinor,
    providerFeeMinor,
    donorPaysMinor: input.giftMinor + collectedPlatformFeeMinor,
    netToCauseMinor,
    collectionActive,
    disclosed: true,
    summary: collectionActive
      ? "The active fee rule is included in this quote. Confirm it before paying."
      : "No platform fee is being collected. A worked example elsewhere on the site is not a charge.",
  };
}

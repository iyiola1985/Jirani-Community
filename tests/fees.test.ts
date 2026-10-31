import { describe, expect, it } from "vitest";

import { getChargeableFeeRule, quoteFee, WORKED_EXAMPLE_FEE_RULE, INACTIVE_DEMO_FEE_RULE } from "@/domain/fees";
import { shillingsToMinor } from "@/domain/money";
import type { FeeRule } from "@/domain/types";

describe("fees", () => {
  it("rounds half up in integer cents", () => {
    const half = quoteFee({
      giftMinor: 1,
      rule: { ...WORKED_EXAMPLE_FEE_RULE, rateBps: 5000, active: true, demoOnly: false },
    });
    expect(half.platformFeeMinor).toBe(1);

    const justUnder = quoteFee({
      giftMinor: 1,
      rule: { ...WORKED_EXAMPLE_FEE_RULE, rateBps: 4999, active: true, demoOnly: false },
    });
    expect(justUnder.platformFeeMinor).toBe(0);
  });

  it("calculates 2.5 percent of KES 1,000 as KES 25", () => {
    const quote = quoteFee({
      giftMinor: shillingsToMinor(1000),
      rule: { ...WORKED_EXAMPLE_FEE_RULE, active: true, demoOnly: false },
    });
    expect(quote.platformFeeMinor).toBe(2_500);
    expect(quote.donorPaysMinor).toBe(102_500);
    expect(quote.netToCauseMinor).toBe(100_000);
    expect(quote.collectedPlatformFeeMinor).toBe(2_500);
  });

  it("does not collect the inactive demonstration rule", () => {
    expect(getChargeableFeeRule([INACTIVE_DEMO_FEE_RULE, WORKED_EXAMPLE_FEE_RULE])).toBeNull();
    const quote = quoteFee({ giftMinor: 100_000, rule: getChargeableFeeRule([INACTIVE_DEMO_FEE_RULE]) });
    expect(quote.collectionActive).toBe(false);
    expect(quote.collectedPlatformFeeMinor).toBe(0);
    expect(quote.donorPaysMinor).toBe(100_000);
    expect(quote.disclosed).toBe(true);
  });

  it("keeps a campaign-borne fee out of the donor charge and out of the cause", () => {
    const rule: FeeRule = {
      ...WORKED_EXAMPLE_FEE_RULE,
      payer: "campaign",
      active: true,
      demoOnly: false,
    };
    const quote = quoteFee({ giftMinor: 100_000, rule });
    expect(quote.donorPaysMinor).toBe(100_000);
    expect(quote.netToCauseMinor).toBe(97_500);
    expect(quote.collectedPlatformFeeMinor).toBe(0);
    expect(quote.campaignBorneFeeMinor).toBe(2_500);
  });

  it("refuses to activate two chargeable rules at once", () => {
    const active = { ...WORKED_EXAMPLE_FEE_RULE, active: true, demoOnly: false };
    expect(() => getChargeableFeeRule([active, { ...active, id: "other" }])).toThrow(/More than one/);
  });
});

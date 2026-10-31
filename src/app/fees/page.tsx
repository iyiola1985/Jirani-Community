import { LegalLayout } from "@/components/legal-layout";
import { panelClass } from "@/components/ui/styles";
import { getChargeableFeeRule, quoteFee, WORKED_EXAMPLE_FEE_RULE } from "@/domain/fees";
import { formatKes } from "@/domain/money";

export const metadata = { title: "Fees" };

export default function FeesPage() {
  const live = quoteFee({ giftMinor: 100_000, rule: getChargeableFeeRule([WORKED_EXAMPLE_FEE_RULE]) });
  const example = quoteFee({
    giftMinor: 100_000,
    rule: { ...WORKED_EXAMPLE_FEE_RULE, active: true, demoOnly: false },
  });
  return (
    <LegalLayout
      eyebrow="Fees and disbursements"
      title="What a shilling is, and what it is not"
      lede="Recipients do not pay to create an account, submit a request, or be verified. Gross gifts are not platform revenue."
    >
      <p>
        Collected now on a gift of {formatKes(live.giftMinor)}: platform fee {formatKes(live.collectedPlatformFeeMinor)}, provider fee {formatKes(live.providerFeeMinor)}, donor pays {formatKes(live.donorPaysMinor)}. {live.summary}
      </p>
      <div className={panelClass}>
        <h2 className="font-serif text-2xl text-ink">Worked example, not a charge</h2>
        <p className="mt-3">
          If a rule called “{example.ruleName}” were switched on, a {formatKes(example.giftMinor)} gift would include a platform fee of {formatKes(example.platformFeeMinor)}. The donor would pay {formatKes(example.donorPaysMinor)} and the cause would be recorded at {formatKes(example.netToCauseMinor)}. That rule is inactive. This paragraph cannot collect it.
        </p>
      </div>
      <p>A future rule can name the campaign type, a percentage or a fixed amount, and who pays: the donor, the campaign, the platform, or an optional amount the donor agrees to. Provider fees are recorded on their own line. They are not treated as income for Jirani.</p>
      <p>Disbursement is a decision recorded after a campaign is closed and reconciliation has started. The decision stores the amount, the reason, and the person who approved it. It does not call a payment provider, and the record is marked as not sent.</p>
    </LegalLayout>
  );
}

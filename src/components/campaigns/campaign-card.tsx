import Link from "next/link";

import type { CampaignTotals } from "@/domain/campaigns";
import { formatKes } from "@/domain/money";
import type { CampaignRecord } from "@/domain/types";
import { panelClass } from "@/components/ui/styles";
import { CampaignStatusPill } from "@/components/ui/status-pill";

export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  }).format(new Date(iso));
}

export function CampaignCard({
  campaign,
  totals,
  href,
  category,
  county,
  contributionCount,
}: {
  campaign: CampaignRecord;
  totals: Pick<CampaignTotals, "netGiftMinor">;
  href?: string;
  category?: string;
  county?: string;
  contributionCount?: number;
}) {
  const remaining = Math.max(0, campaign.targetMinor - totals.netGiftMinor);
  const progress = campaign.targetMinor === 0 ? 0 : Math.min(100, Math.round((totals.netGiftMinor / campaign.targetMinor) * 100));
  return (
    <article className={panelClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-gold">
          {formatWhen(campaign.startsAt)} – {formatWhen(campaign.endsAt)}
        </p>
        <CampaignStatusPill status={campaign.status} />
      </div>
      <h2 className="mt-3 font-serif text-2xl leading-tight">
        <Link href={href ?? `/campaigns/${campaign.id}`} className="hover:underline">
          {campaign.title}
        </Link>
      </h2>
      {category || county ? (
        <p className="mt-2 text-sm text-muted">
          {[category, county].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <p className="mt-3 text-sm leading-6 text-ink-soft">{campaign.objective}</p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-mist" aria-hidden="true">
        <div className="h-1.5 rounded-full bg-lagoon" style={{ width: `${progress}%` }} />
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm min-[380px]:grid-cols-2 sm:grid-cols-3">
        <div>
          <dt className="text-muted">Target</dt>
          <dd className="font-semibold">{formatKes(campaign.targetMinor)}</dd>
        </div>
        <div>
          <dt className="text-muted">Simulated gifts, net</dt>
          <dd className="font-semibold">{formatKes(totals.netGiftMinor)}</dd>
        </div>
        <div>
          <dt className="text-muted">Still open</dt>
          <dd className="font-semibold">{formatKes(remaining)}</dd>
        </div>
      </dl>
      {typeof contributionCount === "number" ? (
        <p className="mt-3 text-sm text-muted">{contributionCount} simulated {contributionCount === 1 ? "gift" : "gifts"} still counting</p>
      ) : null}
      {campaign.demo ? <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gold">Demonstration campaign</p> : null}
    </article>
  );
}

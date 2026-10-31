import { Suspense } from "react";
import { connection } from "next/server";

import { CampaignCard } from "@/components/campaigns/campaign-card";
import { isDatabaseConfigured, isDemoMode } from "@/config/brand";
import { COUNTIES } from "@/data/counties";
import { campaignStatusLabel, categoryLabel } from "@/domain/labels";
import { CAMPAIGN_CATEGORIES, type CampaignCategory, type CampaignRecord, type CampaignStatus } from "@/domain/types";
import { campaignCategoryLabel, listPublicCampaigns, type PublicCampaign } from "@/server/campaigns";
import { getDemoBook } from "@/server/book";

export const metadata = { title: "Campaigns" };

const PUBLIC_STATUSES = ["scheduled", "active", "closed", "reconciling", "reported", "cancelled"] as const satisfies readonly CampaignStatus[];

type Search = { category?: string; county?: string; status?: string; closing?: string };

export default function CampaignsPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Monthly campaigns</p>
      <h1 className="mt-3 font-serif text-4xl tracking-tight sm:text-5xl">Community campaigns</h1>
      <p className="mt-4 max-w-2xl text-lg leading-8 text-ink-soft">
        A campaign has an objective, a target, dates, eligibility, and written rules for choosing who benefits. Totals come from the simulated ledger. The end date does not send the money.
      </p>
      <Suspense fallback={<p className="mt-8 text-ink-soft">Loading campaigns…</p>}>
        <CampaignList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function oneStatus(value: string | undefined): (typeof PUBLIC_STATUSES)[number] | null {
  return PUBLIC_STATUSES.find((status) => status === value) ?? null;
}

function oneCategory(value: string | undefined): CampaignCategory | null {
  return CAMPAIGN_CATEGORIES.find((category) => category === value) ?? null;
}

function closingBefore(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return `${value}T23:59:59+03:00`;
}

function asRecord(campaign: PublicCampaign): CampaignRecord {
  return {
    id: campaign.id,
    title: campaign.title,
    objective: campaign.objective,
    targetMinor: campaign.targetMinor,
    currency: "KES",
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    eligibilityCriteria: campaign.eligibilityCriteria,
    beneficiarySelectionRules: campaign.selectionRules,
    feeDisclosure: campaign.feeDisclosure,
    refundPolicy: campaign.refundPolicy,
    surplusPolicy: campaign.surplusPolicy,
    status: campaign.status,
    demo: false,
  };
}

async function CampaignList({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  const query = await searchParams;
  const category = oneCategory(query.category);
  const county = query.county === "Kenya" || (COUNTIES as readonly string[]).includes(query.county ?? "") ? query.county ?? null : null;
  const status = oneStatus(query.status);
  const closing = closingBefore(query.closing);
  const live = isDatabaseConfigured()
    ? await listPublicCampaigns({ category, county, status, closingBefore: closing })
    : [];
  const filtered = Boolean(category || county || status || closing);
  const active = live.filter((campaign) => campaign.status === "active");
  const scheduled = live.filter((campaign) => campaign.status === "scheduled");
  const completed = live.filter((campaign) =>
    campaign.status === "closed" || campaign.status === "reconciling" || campaign.status === "reported" || campaign.status === "cancelled",
  );
  const book = isDemoMode() && !filtered ? getDemoBook() : null;
  return (
    <>
      <form className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <label className="text-sm font-medium">Category
          <select className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="category" defaultValue={category ?? ""}>
            <option value="">Any</option>
            {CAMPAIGN_CATEGORIES.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">County
          <select className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="county" defaultValue={county ?? ""}>
            <option value="">Any</option>
            <option value="Kenya">Kenya</option>
            {COUNTIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Status
          <select className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="status" defaultValue={status ?? ""}>
            <option value="">Any public status</option>
            {PUBLIC_STATUSES.map((item) => <option key={item} value={item}>{campaignStatusLabel(item)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Closing on or before
          <input className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" type="date" name="closing" defaultValue={query.closing ?? ""} />
        </label>
        <div className="flex items-end">
          <button className="min-h-11 rounded-full bg-lagoon px-5 text-sm font-semibold text-white" type="submit">Filter</button>
        </div>
      </form>
      {status ? (
        <CampaignSection title={campaignStatusLabel(status)} campaigns={live} />
      ) : (
        <>
          <CampaignSection title="Active" campaigns={active} />
          <CampaignSection title="Scheduled" campaigns={scheduled} />
          <CampaignSection title="Recently completed" campaigns={completed} />
        </>
      )}
      {book ? (
        <section className="mt-12">
          <h2 className="font-serif text-3xl">Labelled demonstration campaigns</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">These examples stay in memory. They are not rows in the contribution ledger.</p>
          <div className="mt-6 grid gap-4">
            {book.listCampaigns().map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} totals={book.totalsFor(campaign.id)} />
            ))}
          </div>
        </section>
      ) : null}
      {live.length === 0 && !book ? <p className="mt-8 text-ink-soft">No public campaigns match these filters.</p> : null}
    </>
  );
}

function CampaignSection({ title, campaigns }: { title: string; campaigns: PublicCampaign[] }) {
  if (campaigns.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="font-serif text-3xl">{title}</h2>
      <div className="mt-4 grid gap-4">
        {campaigns.map((campaign) => (
          <CampaignCard
            key={campaign.id}
            href={`/campaigns/${campaign.slug}`}
            campaign={asRecord(campaign)}
            totals={{ netGiftMinor: campaign.raisedMinor }}
            category={campaignCategoryLabel(campaign.category)}
            county={campaign.county}
            contributionCount={campaign.contributionCount}
          />
        ))}
      </div>
    </section>
  );
}

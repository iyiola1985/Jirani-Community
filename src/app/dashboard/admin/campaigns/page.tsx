import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { closeCampaignAction, reconcileCampaignAction } from "@/server/actions/platform";
import { CampaignStatusPill } from "@/components/ui/status-pill";
import { panelClass, primaryButton } from "@/components/ui/styles";
import { isDatabaseConfigured, isDemoMode } from "@/config/brand";
import { formatKes } from "@/domain/money";
import { listAdminCampaigns } from "@/server/campaigns";
import { getDemoBook } from "@/server/book";
import { guardDashboard } from "@/server/guard";

export const metadata = { title: "Campaign management" };

export default function CampaignAdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading campaigns…</p>}>
      <CampaignAdmin searchParams={searchParams} />
    </Suspense>
  );
}

async function CampaignAdmin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  const actor = await guardDashboard("administrator", "/dashboard/admin/campaigns");
  const error = (await searchParams).error;
  const live = isDatabaseConfigured() ? await listAdminCampaigns(actor) : [];
  const samples = isDemoMode() ? getDemoBook().listCampaigns() : [];
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-serif text-4xl">Campaigns</h1>
      <p className="mt-4 leading-7 text-ink-soft">
        Create a draft, send it for review, and publish it only after the eligibility rules and financial disclosures are saved. Closing a campaign records the end. It does not create a disbursement.
      </p>
      {error ? <p role="alert" className="mt-4 text-sm text-clay">{error}</p> : null}
      <Link className={`${primaryButton} mt-6`} href="/dashboard/admin/campaigns/new">New campaign</Link>
      <div className="mt-8 space-y-4">
        {live.map((campaign) => (
          <article key={campaign.id} className={panelClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-serif text-2xl">
                <Link href={`/dashboard/admin/campaigns/${campaign.id}`}>{campaign.title}</Link>
              </h2>
              <CampaignStatusPill status={campaign.status} />
            </div>
            <p className="mt-2 text-sm text-muted">
              {campaign.county} · Target {formatKes(campaign.targetMinor)} · Simulated net {formatKes(campaign.raisedMinor)}
            </p>
          </article>
        ))}
        {live.length === 0 ? <p className="text-sm text-muted">No database campaigns yet.</p> : null}
      </div>
      {samples.length > 0 ? (
        <section className="mt-12">
          <h2 className="font-serif text-3xl">Labelled demonstration campaigns</h2>
          <p className="mt-2 text-sm leading-6 text-ink-soft">These stay in memory. Closing one does not touch the PostgreSQL ledger.</p>
          <div className="mt-6 space-y-4">
            {samples.map((campaign) => (
              <article key={campaign.id} className={panelClass}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-serif text-2xl">{campaign.title}</h3>
                  <CampaignStatusPill status={campaign.status} />
                </div>
                <p className="mt-2 text-sm text-muted">Target {formatKes(campaign.targetMinor)} · Demonstration</p>
                {campaign.status === "active" ? (
                  <form action={closeCampaignAction} className="mt-4 space-y-3">
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <textarea className="w-full rounded-xl border border-line px-3 py-2" name="reason" minLength={8} required placeholder="Why is this demonstration campaign closing?" />
                    <button className={primaryButton} type="submit">Close demonstration campaign</button>
                  </form>
                ) : null}
                {campaign.status === "closed" ? (
                  <form action={reconcileCampaignAction} className="mt-4 space-y-3">
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <textarea className="w-full rounded-xl border border-line px-3 py-2" name="reason" minLength={8} required placeholder="What did you check?" />
                    <button className={primaryButton} type="submit">Start demonstration reconciliation</button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

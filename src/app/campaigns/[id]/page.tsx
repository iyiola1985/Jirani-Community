import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";

import { formatWhen } from "@/components/campaigns/campaign-card";
import { ContributeForm } from "@/components/forms/contribute-form";
import { SandboxPaymentNotice } from "@/components/forms/sandbox-payment-notice";
import { panelClass } from "@/components/ui/styles";
import { CampaignStatusPill } from "@/components/ui/status-pill";
import { isDatabaseConfigured, isDemoMode } from "@/config/brand";
import { formatKes } from "@/domain/money";
import { campaignCategoryLabel, listCampaignGifts, readPublicCampaign, readPublicReport, type PublicCampaign } from "@/server/campaigns";
import { getDemoBook } from "@/server/book";
import { getActor } from "@/server/session";

export const metadata = { title: "Campaign" };

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading campaign…</p>}>
      <CampaignScreen params={params} />
    </Suspense>
  );
}

async function CampaignScreen({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (isDatabaseConfigured()) {
    const campaign = await readPublicCampaign(id);
    if (campaign) return <LiveCampaign campaign={campaign} />;
  }
  if (!isDemoMode()) notFound();
  return <DemoCampaign id={id} />;
}

async function LiveCampaign({ campaign }: { campaign: PublicCampaign }) {
  const gifts = await listCampaignGifts(campaign.id);
  const report = await readPublicReport(campaign.id);
  const actor = await getActor();
  const open = campaign.acceptingGifts;
  const remaining = Math.max(0, campaign.targetMinor - campaign.raisedMinor);
  const sections = [
    ["Why this campaign exists", campaign.objective],
    ["Who can benefit", `${campaign.beneficiaryGroup}. ${campaign.eligibilityCriteria}`],
    ["How beneficiaries are selected", campaign.selectionRules],
    ["How long it runs", `Opens ${formatWhen(campaign.startsAt)} and closes ${formatWhen(campaign.endsAt)}, Nairobi time. Closing stops new simulated gifts. It does not pay anyone.`],
    ["How contributions are accounted for", "A registered donor can record a simulated gift. Only a successful simulation is added to the ledger. Pending and failed attempts stay out of the total. A reversal is a new negative row. The total on this page is the sum of those rows."],
    ["Platform fee", campaign.feeDisclosure],
    ["If the target is missed or passed", campaign.surplusPolicy],
    ["Refunds", campaign.refundPolicy],
    ["If the campaign is cancelled", campaign.cancellationAllowed
      ? "The published policy allows cancellation. Gifts already recorded stay in the ledger. Cancellation does not move them to another campaign."
      : "This campaign's published policy does not allow cancellation after it is scheduled or active."],
    ["How results are reported", "After an administrator closes the campaign and reconciles the ledger, a public report separates money raised, any allocation decision, and money actually paid. An allocation is not a payment."],
  ];
  return (
    <article className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_0.7fr]">
      <div>
        <p className="text-sm text-gold">
          {campaignCategoryLabel(campaign.category)} · {campaign.county} · {formatWhen(campaign.startsAt)} – {formatWhen(campaign.endsAt)}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-4xl tracking-tight">{campaign.title}</h1>
          <CampaignStatusPill status={campaign.status} />
        </div>
        {campaign.imagePath ? (
          // Public campaign art is a reviewed file with a generated name, not a remote URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="mt-6 max-h-80 w-full rounded-3xl object-cover" src={campaign.imagePath} alt="" />
        ) : null}
        <dl className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className={panelClass}><dt className="text-sm text-muted">Target</dt><dd className="mt-1 font-semibold">{formatKes(campaign.targetMinor)}</dd></div>
          <div className={panelClass}><dt className="text-sm text-muted">Simulated gifts, net</dt><dd className="mt-1 font-semibold">{formatKes(campaign.raisedMinor)}</dd></div>
          <div className={panelClass}><dt className="text-sm text-muted">Still open</dt><dd className="mt-1 font-semibold">{formatKes(remaining)}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-muted">{campaign.contributionCount} simulated {campaign.contributionCount === 1 ? "gift" : "gifts"} still counting. These figures are demonstration records.</p>
        <div className="mt-8 space-y-6">
          {sections.map(([title, body]) => (
            <section key={title}>
              <h2 className="font-serif text-2xl">{title}</h2>
              <p className="mt-2 max-w-2xl leading-7 text-ink-soft">{body}</p>
            </section>
          ))}
        </div>
        {gifts.length > 0 ? (
          <section className="mt-8">
            <h2 className="font-serif text-2xl">Simulated gifts</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {gifts.map((gift, index) => (
                <li key={`${gift.displayName}-${index}`}>{gift.displayName} · {formatKes(gift.giftMinor)} · simulated</li>
              ))}
            </ul>
          </section>
        ) : null}
        {report ? (
          <section className="mt-8">
            <h2 className="font-serif text-2xl">Published report</h2>
            <p className="mt-2 max-w-2xl leading-7 text-ink-soft">{report.narrative}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Raised, simulated</dt><dd className="font-semibold">{formatKes(report.raisedMinor)}</dd></div>
              <div><dt className="text-muted">Platform fee charged</dt><dd className="font-semibold">{formatKes(report.platformFeeMinor)}</dd></div>
              <div><dt className="text-muted">Allocated by decision</dt><dd className="font-semibold">{formatKes(report.allocatedMinor)}</dd></div>
              <div><dt className="text-muted">Recorded as paid</dt><dd className="font-semibold">{formatKes(report.paidMinor)}</dd></div>
            </dl>
            <p className="mt-3 text-sm leading-6 text-muted">Raised, allocated, and paid are different figures. Paid stays at KSh 0 until a verified payment record exists. This report does not say a bill has been paid.</p>
          </section>
        ) : (
          <p className="mt-8 text-sm text-muted">A final report is published after reconciliation. Closing the campaign does not publish one by itself.</p>
        )}
      </div>
      <aside className={panelClass}>
        <h2 className="font-serif text-2xl">Contribute</h2>
        {open ? (
          <div className="mt-4">
            <ContributeForm
              campaignId={campaign.id}
              nextPath={`/campaigns/${campaign.slug}`}
              idempotencyKey={randomUUID()}
              signedIn={Boolean(actor)}
              donor={Boolean(actor?.roles.includes("donor"))}
            />
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-ink-soft">
            Simulated gifts are accepted only while a campaign is active and inside its dates. This one is {campaign.status.replaceAll("_", " ")}.
          </p>
        )}
        <SandboxPaymentNotice
          campaignId={campaign.id}
          nextPath={`/campaigns/${campaign.slug}`}
          idempotencyKey={randomUUID()}
          signedIn={Boolean(actor)}
          donor={Boolean(actor?.roles.includes("donor"))}
        />
      </aside>
    </article>
  );
}

async function DemoCampaign({ id }: { id: string }) {
  const book = getDemoBook();
  const campaign = book.getCampaign(id);
  if (!campaign) notFound();
  const totals = book.totalsFor(campaign.id);
  const report = book.listReports().find((item) => item.campaignId === campaign.id);
  const actor = await getActor();
  const sections = [
    ["Objective", campaign.objective],
    ["Eligibility", campaign.eligibilityCriteria],
    ["How beneficiaries are chosen", campaign.beneficiarySelectionRules],
    ["Fees", campaign.feeDisclosure],
    ["Refunds", campaign.refundPolicy],
    ["Surplus", campaign.surplusPolicy],
  ];
  return (
    <article className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_0.7fr]">
      <div>
        <p className="text-sm text-gold">{formatWhen(campaign.startsAt)} – {formatWhen(campaign.endsAt)} · Demonstration</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-4xl tracking-tight">{campaign.title}</h1>
          <CampaignStatusPill status={campaign.status} />
        </div>
        <dl className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className={panelClass}><dt className="text-sm text-muted">Target</dt><dd className="mt-1 font-semibold">{formatKes(campaign.targetMinor)}</dd></div>
          <div className={panelClass}><dt className="text-sm text-muted">Simulated gifts</dt><dd className="mt-1 font-semibold">{formatKes(totals.successfulGiftMinor)}</dd></div>
          <div className={panelClass}><dt className="text-sm text-muted">Platform revenue</dt><dd className="mt-1 font-semibold">{formatKes(totals.platformRevenueMinor)}</dd></div>
        </dl>
        <div className="mt-8 space-y-6">
          {sections.map(([title, body]) => (
            <section key={title}>
              <h2 className="font-serif text-2xl">{title}</h2>
              <p className="mt-2 max-w-2xl leading-7 text-ink-soft">{body}</p>
            </section>
          ))}
        </div>
        {report ? (
          <section className="mt-8">
            <h2 className="font-serif text-2xl">Published report</h2>
            <p className="mt-2 max-w-2xl leading-7 text-ink-soft">{report.narrative}</p>
          </section>
        ) : (
          <p className="mt-8 text-sm text-muted">A final report is published after reconciliation. Closing the campaign does not publish one by itself.</p>
        )}
      </div>
      <aside className={panelClass}>
        <h2 className="font-serif text-2xl">Contribute</h2>
        {campaign.status === "active" ? (
          <div className="mt-4">
            <ContributeForm
              campaignId={campaign.id}
              nextPath={`/campaigns/${campaign.id}`}
              idempotencyKey={randomUUID()}
              signedIn={Boolean(actor)}
              donor={Boolean(actor?.roles.includes("donor"))}
            />
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-ink-soft">Gifts are open while a campaign is active. This one is {campaign.status.replaceAll("_", " ")}.</p>
        )}
        <p className="mt-4 text-sm leading-6 text-ink-soft">Sandbox payments are not available on a labelled demonstration campaign. The form above stays a simulation.</p>
      </aside>
    </article>
  );
}

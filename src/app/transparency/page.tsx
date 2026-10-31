import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";

import { formatWhen } from "@/components/campaigns/campaign-card";
import { panelClass } from "@/components/ui/styles";
import { isDatabaseConfigured, isDemoMode } from "@/config/brand";
import { formatKes } from "@/domain/money";
import { listPublicReports } from "@/server/campaigns";
import { getDemoBook } from "@/server/book";

export const metadata = { title: "Transparency" };

export default function TransparencyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Public record</p>
      <h1 className="mt-3 font-serif text-4xl">Transparency reports</h1>
      <p className="mt-4 leading-7 text-ink-soft">
        A report is published after reconciliation. It separates gifts, platform fees, and approved disbursements. An approval is not a transfer.
      </p>
      <Suspense fallback={<p className="mt-8">Loading reports…</p>}>
        <Reports />
      </Suspense>
    </div>
  );
}

async function Reports() {
  await connection();
  const live = isDatabaseConfigured() ? await listPublicReports() : [];
  const book = isDemoMode() ? getDemoBook() : null;
  const reports = book ? book.listReports() : [];
  if (live.length === 0 && reports.length === 0) return <p className="mt-8 text-ink-soft">No reports have been published.</p>;
  return (
    <div className="mt-8 space-y-4">
      {live.map((report) => (
        <article key={report.campaignId} className={panelClass}>
          <p className="text-sm text-gold">{formatWhen(report.publishedAt)} · Simulated ledger</p>
          <h2 className="mt-2 font-serif text-2xl">
            <Link href={`/campaigns/${report.slug}`}>{report.title}</Link>
          </h2>
          <p className="mt-3 leading-7 text-ink-soft">{report.narrative}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted">Raised</dt><dd>{formatKes(report.raisedMinor)}</dd></div>
            <div><dt className="text-muted">Platform fee charged</dt><dd>{formatKes(report.platformFeeMinor)}</dd></div>
            <div><dt className="text-muted">Allocated by decision</dt><dd>{formatKes(report.allocatedMinor)}</dd></div>
            <div><dt className="text-muted">Recorded as paid</dt><dd>{formatKes(report.paidMinor)}</dd></div>
          </dl>
          <p className="mt-3 text-sm leading-6 text-muted">Raised, allocated, and paid are separate. Paid is KSh 0 until a verified payment record exists.</p>
        </article>
      ))}
      {reports.map((report) => {
        const campaign = book?.getCampaign(report.campaignId);
        return (
          <article key={report.id} className={panelClass}>
            <p className="text-sm text-gold">{formatWhen(report.publishedAt)}{report.demo ? " · Demonstration" : ""}</p>
            <h2 className="mt-2 font-serif text-2xl">
              {campaign ? <Link href={`/campaigns/${campaign.id}`}>{campaign.title}</Link> : "Campaign report"}
            </h2>
            <p className="mt-3 leading-7 text-ink-soft">{report.narrative}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted">Gifts</dt><dd>{formatKes(report.grossGiftMinor)}</dd></div>
              <div><dt className="text-muted">Platform fees</dt><dd>{formatKes(report.platformFeeMinor)}</dd></div>
              <div><dt className="text-muted">Net gifts</dt><dd>{formatKes(report.netGiftMinor)}</dd></div>
              <div><dt className="text-muted">Disbursements approved</dt><dd>{formatKes(report.disbursementApprovedMinor)}</dd></div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}

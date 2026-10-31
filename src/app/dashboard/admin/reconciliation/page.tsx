import { connection } from "next/server";
import { Suspense } from "react";

import { approveDisbursementAction, publishReportAction, refundAction } from "@/server/actions/platform";
import { panelClass, primaryButton } from "@/components/ui/styles";
import { DEMO_OTHER_RECIPIENT_ID } from "@/data/demo";
import { formatKes } from "@/domain/money";
import { getDemoBook } from "@/server/book";
import { guardDashboard } from "@/server/guard";

export const metadata = { title: "Reconciliation" };

export default function ReconciliationPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading the ledger…</p>}>
      <Reconciliation searchParams={searchParams} />
    </Suspense>
  );
}

async function Reconciliation({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  const actor = await guardDashboard("administrator", "/dashboard/admin/reconciliation");
  const error = (await searchParams).error;
  const book = getDemoBook();
  const ledger = book.listLedger(actor);
  const campaigns = book.listCampaigns().filter((campaign) => campaign.status === "closed" || campaign.status === "reconciling");
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="font-serif text-4xl">Reconciliation</h1>
      <p className="mt-4 max-w-2xl leading-7 text-ink-soft">
        Amounts already recorded are not edited here. A refund adds a reversal. A disbursement approval is stored with funds sent set to no.
      </p>
      {error ? <p role="alert" className="mt-4 text-sm text-clay">{error}</p> : null}
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-2 pr-3 font-medium">Kind</th>
              <th className="py-2 pr-3 font-medium">Effect</th>
              <th className="py-2 pr-3 font-medium">Amount</th>
              <th className="py-2 font-medium">Memo</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((entry) => (
              <tr key={entry.id} className="border-b border-line">
                <td className="py-2 pr-3">{entry.kind}</td>
                <td className="py-2 pr-3">{entry.effect}</td>
                <td className="py-2 pr-3">{formatKes(entry.amountMinor)}</td>
                <td className="py-2">{entry.memo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-8 grid gap-4">
        {campaigns.map((campaign) => (
          <section key={campaign.id} className={panelClass}>
            <h2 className="font-serif text-2xl">{campaign.title}</h2>
            <p className="mt-2 text-sm text-muted">Status {campaign.status}. Net gifts {formatKes(book.totalsFor(campaign.id).netGiftMinor)}.</p>
            <form action={approveDisbursementAction} className="mt-4 space-y-3">
              <input type="hidden" name="campaignId" value={campaign.id} />
              <input type="hidden" name="beneficiaryOwnerId" value={DEMO_OTHER_RECIPIENT_ID} />
              <label className="block text-sm">Amount in shillings
                <input className="mt-1 w-full rounded-xl border border-line px-3 py-2" name="amountShillings" inputMode="numeric" required />
              </label>
              <textarea className="w-full rounded-xl border border-line px-3 py-2" name="reason" minLength={8} required placeholder="Why this approval matches the written rules" />
              <button className={primaryButton} type="submit">Approve disbursement</button>
            </form>
            {campaign.status === "reconciling" ? (
              <form action={publishReportAction} className="mt-4 space-y-3">
                <input type="hidden" name="campaignId" value={campaign.id} />
                <textarea className="w-full rounded-xl border border-line px-3 py-2" name="narrative" minLength={20} required placeholder="What was decided, and that no transfer was sent" />
                <button className={primaryButton} type="submit">Publish report</button>
              </form>
            ) : null}
          </section>
        ))}
      </div>
      <section className={`${panelClass} mt-8`}>
        <h2 className="font-serif text-2xl">Reverse a simulated gift</h2>
        <p className="mt-2 text-sm leading-6 text-ink-soft">This writes a new refund row. The original gift amount stays in the ledger.</p>
        <ul className="mt-4 space-y-4">
          {ledger
            .filter((entry) => entry.kind === "gift" && entry.contributionId)
            .map((entry) => (
              <li key={entry.contributionId}>
                <form action={refundAction} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                  <input type="hidden" name="contributionId" value={entry.contributionId ?? ""} />
                  <label className="text-sm">{formatKes(entry.amountMinor)}
                    <input className="mt-1 w-full rounded-xl border border-line px-3 py-2" name="reason" minLength={8} required placeholder="Reason for the reversal" />
                  </label>
                  <button className={primaryButton} type="submit">Record reversal</button>
                </form>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

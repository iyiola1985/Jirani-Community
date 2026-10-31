import Link from "next/link";
import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { Suspense } from "react";

import { DecisionForm } from "@/components/admin/decision-form";
import { panelClass } from "@/components/ui/styles";
import { PaymentStatusPill } from "@/components/ui/status-pill";
import { isDatabaseConfigured } from "@/config/brand";
import { formatKes } from "@/domain/money";
import { reverseLedgerAction } from "@/server/actions/platform";
import { guardDashboard } from "@/server/guard";
import { listFinance } from "@/server/ledger";

export const metadata = { title: "Demonstration ledger" };

export default function FinancePage({ searchParams }: { searchParams: Promise<{ reference?: string; error?: string }> }) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading the demonstration ledger…</p>}>
      <Finance searchParams={searchParams} />
    </Suspense>
  );
}

async function Finance({ searchParams }: { searchParams: Promise<{ reference?: string; error?: string }> }) {
  await connection();
  const actor = await guardDashboard("administrator", "/dashboard/admin/finance");
  const query = await searchParams;
  const reference = (query.reference ?? "").trim().slice(0, 80);
  const overview = isDatabaseConfigured() ? await listFinance(actor, reference) : null;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Administrator</p>
      <h1 className="mt-3 font-serif text-4xl">Demonstration ledger</h1>
      <p className="mt-4 max-w-2xl leading-7 text-ink-soft">
        Every figure on this page is simulated. Successful rows increase a request total. Pending and failed rows do not. A reversal adds a new line and leaves the original gift in place. Nothing is paid out.
      </p>
      <p className="mt-4 text-sm font-semibold">
        <Link href="/dashboard/admin">Back to the review desk</Link>
      </p>
      {query.error ? <p role="alert" className="mt-4 text-sm text-clay">{query.error}</p> : null}
      {!overview ? <p className="mt-8">The database is not configured, so there is no persistent ledger to show.</p> : (
        <>
          <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className={panelClass}><dt className="text-sm text-muted">Successful simulations</dt><dd className="mt-1 font-serif text-3xl">{overview.successfulCount}</dd></div>
            <div className={panelClass}><dt className="text-sm text-muted">Pending</dt><dd className="mt-1 font-serif text-3xl">{overview.pendingCount}</dd></div>
            <div className={panelClass}><dt className="text-sm text-muted">Failed</dt><dd className="mt-1 font-serif text-3xl">{overview.failedCount}</dd></div>
            <div className={panelClass}><dt className="text-sm text-muted">Net simulated total</dt><dd className="mt-1 font-serif text-3xl">{formatKes(overview.simulatedTotalMinor)}</dd></div>
          </dl>
          <p className="mt-3 text-sm text-muted">{overview.reversalCount} reversal {overview.reversalCount === 1 ? "row" : "rows"}. Demonstration data only.</p>
          <form className="mt-8 flex flex-wrap items-end gap-3" method="get">
            <label className="text-sm font-medium">Reference
              <input className="mt-1.5 block w-full min-w-0 rounded-xl border border-line bg-paper px-3 py-2.5 sm:w-80" name="reference" defaultValue={reference} placeholder="sim_ or SIM-" />
            </label>
            <button className="inline-flex min-h-11 items-center rounded-full bg-lagoon px-5 text-sm font-semibold text-white" type="submit">Search</button>
          </form>
          <div className="mt-8 grid gap-4">
            {overview.rows.length === 0 ? <p className={panelClass}>No simulated contributions match that search.</p> : null}
            {overview.rows.map((row) => (
              <article key={row.id} className={panelClass}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-serif text-2xl">{row.requestTitle}</h2>
                  <PaymentStatusPill status={row.status} />
                </div>
                <p className="mt-2 text-sm text-muted">
                  {formatKes(row.giftMinor)} · {row.recognition === "anonymous" || !row.publicName ? "Anonymous" : row.publicName} · Request {row.requestStatus}
                </p>
                <p className="mt-1 break-all text-sm text-muted">{row.createdAt.slice(0, 10)} · {row.providerReference}{row.receiptNumber ? ` · ${row.receiptNumber}` : ""}</p>
                {row.status === "successful" ? (
                  <div className="mt-4">
                    <DecisionForm
                      action={reverseLedgerAction}
                      confirm="This adds a reversal. The original simulated gift stays in the ledger."
                      label="Record a reversal"
                    >
                      <input type="hidden" name="contributionId" value={row.id} />
                      <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                      <label className="block text-sm font-medium">Amount to reverse, in shillings
                        <input className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="amountShillings" inputMode="numeric" min={100} step={1} required />
                      </label>
                      <label className="block text-sm font-medium">Reason
                        <textarea className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="reason" minLength={8} required />
                      </label>
                    </DecisionForm>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          <h2 className="mt-10 font-serif text-2xl">Event history</h2>
          <div className="mt-4 max-w-full overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Kind</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Reference</th>
                  <th className="py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {overview.events.map((event) => (
                  <tr key={event.id} className="border-b border-line align-top">
                    <td className="py-2 pr-3">{event.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="py-2 pr-3">{event.kind}</td>
                    <td className="py-2 pr-3">{event.amountMinor === null ? "—" : formatKes(event.amountMinor)}</td>
                    <td className="break-all py-2 pr-3">{event.reference}</td>
                    <td className="py-2">{event.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { panelClass } from "@/components/ui/styles";
import { isDatabaseConfigured } from "@/config/brand";
import { formatKes } from "@/domain/money";
import { guardDashboard } from "@/server/guard";
import { listSandboxPayments } from "@/server/sandbox-payments";

export const metadata = { title: "Sandbox payments" };

export default function SandboxPaymentsPage({ searchParams }: { searchParams: Promise<{ reference?: string }> }) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading sandbox payments…</p>}>
      <Payments searchParams={searchParams} />
    </Suspense>
  );
}

async function Payments({ searchParams }: { searchParams: Promise<{ reference?: string }> }) {
  await connection();
  const actor = await guardDashboard("administrator", "/dashboard/admin/payments");
  const reference = ((await searchParams).reference ?? "").trim().slice(0, 80);
  const rows = isDatabaseConfigured() ? await listSandboxPayments(actor, reference) : [];
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Administrator</p>
      <h1 className="mt-3 font-serif text-4xl">Sandbox payments</h1>
      <p className="mt-4 max-w-2xl leading-7 text-ink-soft">
        Pending, quarantined, and conflicting callbacks stay here until a verified result posts one gift. A posted gift is not a payout, and a missing provider fee is shown as not yet reconciled.
      </p>
      <p className="mt-4 text-sm font-semibold"><Link href="/dashboard/admin">Back to the review desk</Link></p>
      <form className="mt-8 flex flex-wrap items-end gap-3" method="get">
        <label className="text-sm font-medium">Reference or status
          <input className="mt-1.5 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 sm:w-80" name="reference" defaultValue={reference} />
        </label>
        <button className="inline-flex min-h-11 items-center rounded-full bg-lagoon px-5 text-sm font-semibold text-white" type="submit">Search</button>
      </form>
      {!isDatabaseConfigured() ? <p className="mt-8">The database is not configured.</p> : null}
      <div className="mt-8 grid gap-4">
        {rows.length === 0 ? <p className={panelClass}>No sandbox payments match that search.</p> : null}
        {rows.map((payment) => (
          <article key={payment.id} className={panelClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-serif text-2xl">{payment.title}</h2>
              <p className="text-sm font-semibold">{payment.status}</p>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Internal reference</dt><dd className="break-all">{payment.internalReference}</dd></div>
              <div><dt className="text-muted">Provider reference</dt><dd className="break-all">{payment.providerReference ?? "Not issued"}</dd></div>
              <div><dt className="text-muted">Expected amount</dt><dd>{formatKes(payment.giftMinor)}</dd></div>
              <div><dt className="text-muted">Provider fee</dt><dd>{payment.providerFeeMinor === null ? "Not yet reconciled" : formatKes(payment.providerFeeMinor)}</dd></div>
              <div><dt className="text-muted">Ledger gift posted</dt><dd>{payment.ledgerPosted ? "Yes" : "No"}</dd></div>
              <div><dt className="text-muted">Started</dt><dd>{payment.createdAt.slice(0, 16).replace("T", " ")}</dd></div>
            </dl>
            {payment.lastError ? <p className="mt-3 text-sm text-clay">{payment.lastError}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { panelClass } from "@/components/ui/styles";
import { formatKes } from "@/domain/money";
import { guardDashboard } from "@/server/guard";
import { readSandboxPayment } from "@/server/sandbox-payments";

export const metadata = { title: "Sandbox payment" };

export default function SandboxPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading payment…</p>}>
      <Payment params={params} />
    </Suspense>
  );
}

async function Payment({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const actor = await guardDashboard("donor", `/dashboard/donor/payments/${id}`);
  const payment = await readSandboxPayment(actor, id);
  if (!payment) notFound();
  const back = payment.targetKind === "campaign" ? `/campaigns/${payment.targetId}` : `/requests/${payment.targetId}`;
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="rounded-2xl bg-sand px-4 py-3 text-sm leading-6">
        This is the server record of a sandbox payment. It is not an M-Pesa receipt. A pending payment has not been added to a fundraising total.
      </p>
      <h1 className="mt-6 font-serif text-4xl">{payment.internalReference}</h1>
      <p className="mt-2 text-sm text-muted">{payment.status}</p>
      <dl className={`${panelClass} mt-6 grid gap-3 text-sm sm:grid-cols-2`}>
        <div><dt className="text-muted">{payment.targetKind === "campaign" ? "Campaign" : "Request"}</dt><dd className="font-semibold">{payment.title}</dd></div>
        <div><dt className="text-muted">Expected amount</dt><dd className="font-semibold">{formatKes(payment.giftMinor)}</dd></div>
        <div><dt className="text-muted">Provider fee</dt><dd className="font-semibold">{payment.providerFeeMinor === null ? "Not yet reconciled" : formatKes(payment.providerFeeMinor)}</dd></div>
        <div><dt className="text-muted">Ledger gift posted</dt><dd className="font-semibold">{payment.ledgerPosted ? "Yes" : "No"}</dd></div>
        <div><dt className="text-muted">Provider reference</dt><dd className="break-all font-semibold">{payment.providerReference ?? "Not issued"}</dd></div>
        <div><dt className="text-muted">Verified</dt><dd className="font-semibold">{payment.verifiedAt ? payment.verifiedAt.slice(0, 16).replace("T", " ") : "Not yet"}</dd></div>
      </dl>
      {payment.lastError ? <p className="mt-4 text-sm text-clay">{payment.lastError}</p> : null}
      <p className="mt-4 text-sm">
        <Link className="font-semibold text-lagoon" href={back}>Back</Link>
      </p>
    </article>
  );
}

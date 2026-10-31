import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { isDatabaseConfigured } from "@/config/brand";
import { simulateCallbackAction } from "@/server/actions/platform";
import { panelClass, primaryButton, quietButton } from "@/components/ui/styles";
import { PaymentStatusPill } from "@/components/ui/status-pill";
import { formatKes } from "@/domain/money";
import { getDemoBook } from "@/server/book";
import { guardDashboard } from "@/server/guard";
import { readOwnContribution, type StoredContribution } from "@/server/ledger";

export const metadata = { title: "Simulated receipt" };

export default function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading receipt…</p>}>
      <Receipt params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Receipt({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const { id } = await params;
  const actor = await guardDashboard("donor", `/dashboard/donor/contributions/${id}`);
  const error = (await searchParams).error;
  const stored = isDatabaseConfigured() ? await readOwnContribution(actor, id) : null;
  if (stored) return <StoredReceipt contribution={stored} error={error} />;
  const contribution = getDemoBook().readContribution(actor, id);
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="rounded-2xl bg-sand px-4 py-3 text-sm leading-6">
        Simulated receipt. The mock provider recorded this. No M-Pesa payment, card charge, or bank transfer happened.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-4xl">{contribution.receiptNumber ?? "Pending simulation"}</h1>
        <PaymentStatusPill status={contribution.status} />
      </div>
      {error ? <p role="alert" className="mt-4 text-sm text-clay">{error}</p> : null}
      <dl className={`${panelClass} mt-6 grid gap-3 text-sm sm:grid-cols-2`}>
        <div><dt className="text-muted">Gift</dt><dd className="font-semibold">{formatKes(contribution.giftMinor)}</dd></div>
        <div><dt className="text-muted">Platform fee collected</dt><dd className="font-semibold">{formatKes(contribution.collectedPlatformFeeMinor)}</dd></div>
        <div><dt className="text-muted">Provider fee</dt><dd className="font-semibold">{formatKes(contribution.providerFeeMinor)}</dd></div>
        <div><dt className="text-muted">Recorded for the cause</dt><dd className="font-semibold">{formatKes(contribution.netToCauseMinor)}</dd></div>
        <div><dt className="text-muted">Donor would pay</dt><dd className="font-semibold">{formatKes(contribution.donorPaysMinor)}</dd></div>
        <div><dt className="text-muted">Provider reference</dt><dd className="break-all font-semibold">{contribution.providerReference}</dd></div>
      </dl>
      {contribution.status === "pending" ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <form action={simulateCallbackAction}>
            <input type="hidden" name="contributionId" value={contribution.id} />
            <input type="hidden" name="outcome" value="successful" />
            <button className={primaryButton} type="submit">Simulate a successful provider callback</button>
          </form>
          <form action={simulateCallbackAction}>
            <input type="hidden" name="contributionId" value={contribution.id} />
            <input type="hidden" name="outcome" value="failed" />
            <button className={quietButton} type="submit">Simulate a failed callback</button>
          </form>
        </div>
      ) : null}
    </article>
  );
}

function StoredReceipt({ contribution, error }: { contribution: StoredContribution; error?: string }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="rounded-2xl bg-sand px-4 py-3 text-sm leading-6">
        Demonstration record. The simulator wrote this. It is not an M-Pesa receipt, not a card charge, and not a tax receipt. No money moved, and nothing has been paid out.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-4xl">{contribution.receiptNumber ?? "Pending simulation"}</h1>
        <PaymentStatusPill status={contribution.status} />
      </div>
      {error ? <p role="alert" className="mt-4 text-sm text-clay">{error}</p> : null}
      <dl className={`${panelClass} mt-6 grid gap-3 text-sm sm:grid-cols-2`}>
        <div><dt className="text-muted">{contribution.campaignId ? "Campaign" : "Request"}</dt><dd className="font-semibold">{contribution.requestTitle}</dd></div>
        <div><dt className="text-muted">Gift</dt><dd className="font-semibold">{formatKes(contribution.giftMinor)}</dd></div>
        <div><dt className="text-muted">Platform fee</dt><dd className="font-semibold">Ksh 0</dd></div>
        <div><dt className="text-muted">Recorded for the cause</dt><dd className="font-semibold">{formatKes(contribution.netToCauseMinor)}</dd></div>
        <div><dt className="text-muted">Public name</dt><dd className="font-semibold">{contribution.recognition === "anonymous" || !contribution.publicName ? "Anonymous" : contribution.publicName}</dd></div>
        <div><dt className="text-muted">Demonstration reference</dt><dd className="break-all font-semibold">{contribution.providerReference}</dd></div>
        <div><dt className="text-muted">Started</dt><dd className="font-semibold">{contribution.createdAt.slice(0, 16).replace("T", " ")}</dd></div>
        <div><dt className="text-muted">Simulator result</dt><dd className="font-semibold">{contribution.settledAt ? contribution.settledAt.slice(0, 16).replace("T", " ") : "Not reported yet"}</dd></div>
      </dl>
      <p className="mt-4 text-sm">
        <Link className="font-semibold text-lagoon" href={contribution.campaignId ? `/campaigns/${contribution.campaignId}` : `/requests/${contribution.requestId}`}>
          {contribution.campaignId ? "Back to the campaign" : "Back to the request"}
        </Link>
      </p>
      {contribution.status === "pending" ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <form action={simulateCallbackAction}>
            <input type="hidden" name="contributionId" value={contribution.id} />
            <input type="hidden" name="outcome" value="successful" />
            <button className={primaryButton} type="submit">Simulate a successful result</button>
          </form>
          <form action={simulateCallbackAction}>
            <input type="hidden" name="contributionId" value={contribution.id} />
            <input type="hidden" name="outcome" value="failed" />
            <button className={quietButton} type="submit">Simulate a failed result</button>
          </form>
        </div>
      ) : null}
    </article>
  );
}

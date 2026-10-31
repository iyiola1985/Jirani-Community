import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { isDatabaseConfigured } from "@/config/brand";
import { panelClass, primaryButton } from "@/components/ui/styles";
import { PaymentStatusPill } from "@/components/ui/status-pill";
import { formatKes } from "@/domain/money";
import { getDemoBook } from "@/server/book";
import { guardDashboard } from "@/server/guard";
import { listDonorContributions } from "@/server/ledger";

export const metadata = { title: "Your giving" };

export default function DonorPage() {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading your giving…</p>}>
      <DonorHome />
    </Suspense>
  );
}

async function DonorHome() {
  await connection();
  const actor = await guardDashboard("donor", "/dashboard/donor");
  const stored = isDatabaseConfigured() ? await listDonorContributions(actor) : [];
  const samples = getDemoBook().listContributionsForDonor(actor);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Donor</p>
      <h1 className="mt-3 font-serif text-4xl">Hello, {actor.displayName}</h1>
      <p className="mt-4 max-w-2xl leading-7 text-ink-soft">
        These rows are demonstration records. A receipt is not proof that money was paid, and it is not a tax receipt. Nothing is paid out from here.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link className={primaryButton} href="/requests">Browse requests</Link>
        <Link className={primaryButton} href="/campaigns">Browse campaigns</Link>
      </div>
      <div className="mt-8 grid gap-4">
        {stored.length === 0 && samples.length === 0 ? (
          <p className={panelClass}>No simulated gift yet. A published request can take a demonstration amount of KSh 100 or more.</p>
        ) : null}
        {stored.map((gift) => (
          <article key={gift.id} className={panelClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-serif text-2xl">{formatKes(gift.giftMinor)}</h2>
              <PaymentStatusPill status={gift.status} />
            </div>
            <p className="mt-2 text-sm text-muted">
              {gift.requestTitle} · {gift.recognition === "anonymous" || !gift.publicName ? "Anonymous on the public page" : gift.publicName} · Demonstration · No fee deducted
            </p>
            <p className="mt-1 text-sm text-muted">{gift.createdAt.slice(0, 10)} · {gift.providerReference}</p>
            <Link className="mt-3 inline-block text-sm font-semibold text-lagoon" href={`/dashboard/donor/contributions/${gift.id}`}>
              Open demonstration receipt
            </Link>
          </article>
        ))}
        {samples.map((gift) => (
          <article key={gift.id} className={panelClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-serif text-2xl">{formatKes(gift.giftMinor)}</h2>
              <PaymentStatusPill status={gift.status} />
            </div>
            <p className="mt-2 text-sm text-muted">
              Sample ledger · {gift.recognition === "anonymous" || !gift.publicName ? "Anonymous on the public page" : gift.publicName} · Fee collected {formatKes(gift.collectedPlatformFeeMinor)}
            </p>
            <Link className="mt-3 inline-block text-sm font-semibold text-lagoon" href={`/dashboard/donor/contributions/${gift.id}`}>
              Open receipt
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";

import { CampaignCard } from "@/components/campaigns/campaign-card";
import { RequestCard } from "@/components/requests/request-card";
import { clayButton, panelClass, primaryButton, quietButton } from "@/components/ui/styles";
import { isDatabaseConfigured, isDemoMode } from "@/config/brand";
import { formatKes } from "@/domain/money";
import { listPublished } from "@/server/assistance";
import { getDemoBook } from "@/server/book";

export default function HomePage() {
  return (
    <div>
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:py-20">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Kenya · Community assistance</p>
          <h1 className="mt-4 max-w-xl font-serif text-4xl leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Help that stays close, and on the record.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-ink-soft">
            Jirani means neighbour. People ask for support here, and others give it, with private documents kept private and every shilling written down before anyone is paid.
          </p>
        </div>
        <div className="grid gap-4">
          <article className={`${panelClass} border-lagoon/30`}>
            <p className="text-sm font-semibold text-lagoon">Get help</p>
            <h2 className="mt-2 font-serif text-3xl">Request assistance</h2>
            <p className="mt-3 text-sm leading-6 text-ink-soft">
              Food, rent, electricity, cooking gas, school costs, medical bills, or funeral expenses. Creating an account, submitting a request, and verification are free.
            </p>
            <Link href="/register" className={`${primaryButton} mt-5`}>
              Start a request
            </Link>
          </article>
          <article className={panelClass}>
            <p className="text-sm font-semibold text-clay">Give help</p>
            <h2 className="mt-2 font-serif text-3xl">Contribute</h2>
            <p className="mt-3 text-sm leading-6 text-ink-soft">
              Browse verified requests and time-limited campaigns. Any fee is shown before you confirm. This demonstration does not move money.
            </p>
            <Link href="/requests" className={`${clayButton} mt-5`}>
              Browse requests
            </Link>
          </article>
        </div>
      </section>

      <section className="border-y border-line bg-paper-raised/70">
        <ol className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 md:grid-cols-4">
          {[
            ["1", "A person submits a request and keeps evidence private."],
            ["2", "An administrator reviews it. Only an approved alias is published."],
            ["3", "A gift is confirmed by the payment provider, not by the browser."],
            ["4", "Closing a campaign does not send money. Disbursement is a separate approval."],
          ].map(([step, text]) => (
            <li key={step}>
              <p className="font-serif text-2xl text-lagoon">{step}</p>
              <p className="mt-2 text-sm leading-6 text-ink-soft">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <Suspense fallback={<p className="px-6 py-16 text-ink-soft">Loading demonstration records…</p>}>
        <HomeRecords />
      </Suspense>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-14 sm:px-6 md:grid-cols-3">
        <div className={panelClass}>
          <h2 className="font-serif text-2xl">The gift</h2>
          <p className="mt-3 text-sm leading-6 text-ink-soft">The amount a donor chooses for a request or a campaign. It is not platform revenue.</p>
        </div>
        <div className={panelClass}>
          <h2 className="font-serif text-2xl">The fee</h2>
          <p className="mt-3 text-sm leading-6 text-ink-soft">Recipients are not charged to join, submit, or be verified. No platform fee is collected in this environment.</p>
        </div>
        <div className={panelClass}>
          <h2 className="font-serif text-2xl">The disbursement</h2>
          <p className="mt-3 text-sm leading-6 text-ink-soft">After reconciliation, an administrator records an approval. That record is not a transfer.</p>
        </div>
        <Link href="/fees" className={`${quietButton} md:col-span-3 md:w-fit`}>
          Read how fees and disbursements work
        </Link>
      </section>
    </div>
  );
}

async function HomeRecords() {
  await connection();
  if (!isDemoMode()) return <PublishedHome />;
  const book = getDemoBook();
  const requests = book.listPublishedRequests();
  const campaigns = book.listCampaigns();
  const featured = campaigns.find((campaign) => campaign.status === "active") ?? null;
  const simulatedGiftMinor =
    requests.reduce((sum, request) => sum + request.raisedMinor, 0) +
    campaigns.reduce((sum, campaign) => sum + book.totalsFor(campaign.id).netGiftMinor, 0);
  return (
    <div>
      {featured ? (
        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Featured demonstration campaign</p>
          <div className="mt-4 max-w-3xl">
            <CampaignCard campaign={featured} totals={book.totalsFor(featured.id)} />
          </div>
        </section>
      ) : null}
      <section className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <h2 className="font-serif text-3xl">Verified requests</h2>
          <Link href="/requests" className="text-sm font-semibold text-lagoon">See all</Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {requests.slice(0, 4).map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </div>
      </section>
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <div className="rounded-3xl bg-lagoon px-6 py-8 text-white">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#e4c08a]">Demonstration figures</p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">
            These numbers are sample records for the interface. They are not live platform results, and the gifts were never collected.
          </p>
          <dl className="mt-6 grid gap-6 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-white/70">Published requests</dt>
              <dd className="mt-1 font-serif text-4xl">{requests.length}</dd>
            </div>
            <div>
              <dt className="text-sm text-white/70">Active campaigns</dt>
              <dd className="mt-1 font-serif text-4xl">{campaigns.filter((campaign) => campaign.status === "active").length}</dd>
            </div>
            <div>
              <dt className="text-sm text-white/70">Simulated gifts, net</dt>
              <dd className="mt-1 font-serif text-4xl">{formatKes(simulatedGiftMinor)}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}

async function PublishedHome() {
  const requests = isDatabaseConfigured()
    ? (await listPublished({ category: null, county: null, urgent: null, funding: "any", page: 1 })).requests.slice(0, 4)
    : [];
  if (requests.length === 0) {
    return (
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="font-serif text-3xl">Nothing published yet</h2>
        <p className="mt-3 max-w-2xl text-ink-soft">Published requests will appear here. This page does not invent results.</p>
      </section>
    );
  }
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
      <div className="flex items-end justify-between gap-4">
        <h2 className="font-serif text-3xl">Published requests</h2>
        <Link href="/requests" className="text-sm font-semibold text-lagoon">See all</Link>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {requests.map((request) => (
          <RequestCard key={request.id} request={request} />
        ))}
      </div>
    </section>
  );
}

import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { panelClass, primaryButton } from "@/components/ui/styles";
import { RequestStatusPill, VerificationStatusPill } from "@/components/ui/status-pill";
import { isDatabaseConfigured } from "@/config/brand";
import { requestStatusLabel } from "@/domain/labels";
import { formatKes } from "@/domain/money";
import type { RequestStatus } from "@/domain/types";
import { findDemoActor } from "@/server/accounts";
import { recipientOverview } from "@/server/assistance";
import { getDemoBook } from "@/server/book";
import { guardDashboard } from "@/server/guard";

export const metadata = { title: "Your requests" };

const COUNT_LABELS: Array<{ status: RequestStatus; label: string }> = [
  { status: "submitted", label: "Submitted" },
  { status: "under_review", label: "Awaiting review" },
  { status: "published", label: "Published" },
  { status: "needs_information", label: "Needs information" },
  { status: "closed", label: "Closed" },
];

export default function RecipientPage() {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading your requests…</p>}>
      <RecipientHome />
    </Suspense>
  );
}

async function RecipientHome() {
  await connection();
  const actor = await guardDashboard("recipient", "/dashboard/recipient");
  if (findDemoActor(actor.id)) return <DemoRecipient name={actor.displayName} actorId={actor.id} />;
  if (!isDatabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="font-serif text-4xl">Hello, {actor.displayName}</h1>
        <p className="mt-4 max-w-2xl leading-7 text-ink-soft">The request database is not connected, so a new application cannot be saved yet.</p>
      </div>
    );
  }
  const overview = await recipientOverview(actor);
  const total = overview.requests.length;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Recipient</p>
      <h1 className="mt-3 font-serif text-4xl">Hello, {actor.displayName}</h1>
      <p className="mt-4 max-w-2xl leading-7 text-ink-soft">
        Your private notes and documents stay with the review. Visitors see a request only after an administrator publishes it. No money is shown here unless a disbursement has actually been recorded, and none is recorded in this environment.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <VerificationStatusPill status={overview.verificationStatus} />
        <Link href="/dashboard/recipient/requests/new" className={primaryButton}>New request</Link>
      </div>
      <dl className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className={panelClass}>
          <dt className="text-sm text-muted">Your requests</dt>
          <dd className="mt-1 font-serif text-3xl">{total}</dd>
        </div>
        {COUNT_LABELS.map((item) => (
          <div key={item.status} className={panelClass}>
            <dt className="text-sm text-muted">{item.label}</dt>
            <dd className="mt-1 font-serif text-3xl">{overview.counts[item.status]}</dd>
          </div>
        ))}
      </dl>
      {total === 0 ? (
        <section className={`${panelClass} mt-8`}>
          <h2 className="font-serif text-2xl">No request yet</h2>
          <p className="mt-3 max-w-2xl leading-7 text-ink-soft">
            When you are ready, describe the help you need. You can save a draft and come back. Submitting is free, and it does not publish the request or promise funding.
          </p>
        </section>
      ) : (
        <div className="mt-8 grid gap-4">
          {overview.requests.map((request) => (
            <article key={request.id} className={panelClass}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-serif text-2xl">{request.title}</h2>
                <RequestStatusPill status={request.status} />
              </div>
              <p className="mt-2 text-sm text-muted">{formatKes(request.amountNeededMinor)} · {request.county} · Public name {request.publicAlias}</p>
              {request.applicantFeedback ? <p className="mt-4 rounded-2xl bg-sand px-4 py-3 text-sm leading-6">Message from the review: {request.applicantFeedback}</p> : null}
              <Link className="mt-4 inline-block text-sm font-semibold text-lagoon" href={`/dashboard/recipient/requests/${request.id}`}>
                View request and history
              </Link>
            </article>
          ))}
        </div>
      )}
      <section className="mt-10">
        <h2 className="font-serif text-2xl">Recent status updates</h2>
        {overview.recent.length === 0 ? <p className="mt-3 text-sm text-ink-soft">Updates will appear here after you save or submit a request.</p> : (
          <ul className="mt-3 space-y-2 text-sm">
            {overview.recent.map((event) => (
              <li key={event.id}>
                <Link className="font-semibold text-lagoon" href={`/dashboard/recipient/requests/${event.requestId}`}>{event.title}</Link>
                <span className="text-ink-soft"> · {requestStatusLabel(event.toStatus)} · {event.createdAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function DemoRecipient({ name, actorId }: { name: string; actorId: string }) {
  const actor = { id: actorId, roles: ["recipient"] as const, displayName: name };
  const book = getDemoBook();
  const requests = book.listOwnedRequests(actor);
  const verification = book.verificationFor(actor.id);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Recipient · Demonstration</p>
      <h1 className="mt-3 font-serif text-4xl">Hello, {name}</h1>
      <p className="mt-4 max-w-2xl leading-7 text-ink-soft">
        These are labelled sample requests. They are not live applications, and the figures are not money received.
      </p>
      <div className="mt-6">
        <VerificationStatusPill status={verification?.status ?? "not_started"} />
      </div>
      <div className="mt-8 grid gap-4">
        {requests.map((request) => (
          <article key={request.id} className={panelClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-serif text-2xl">{request.title}</h2>
              <RequestStatusPill status={request.status} />
            </div>
            <p className="mt-2 text-sm text-muted">{formatKes(request.amountNeededMinor)} · {request.county} · Demonstration</p>
          </article>
        ))}
      </div>
    </div>
  );
}

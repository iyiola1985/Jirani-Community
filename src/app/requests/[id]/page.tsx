import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";

import { ContributeForm } from "@/components/forms/contribute-form";
import { SandboxPaymentNotice } from "@/components/forms/sandbox-payment-notice";
import { panelClass } from "@/components/ui/styles";
import { RequestStatusPill } from "@/components/ui/status-pill";
import { isDatabaseConfigured, isDemoMode } from "@/config/brand";
import { categoryLabel } from "@/domain/labels";
import { formatKes } from "@/domain/money";
import type { PublicRequest } from "@/domain/types";
import { readPublished } from "@/server/assistance";
import { getDemoBook } from "@/server/book";
import { listPublicGifts } from "@/server/ledger";
import { getActor } from "@/server/session";

export const metadata = { title: "Request" };

export default function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading request…</p>}>
      <RequestScreen params={params} />
    </Suspense>
  );
}

async function RequestScreen({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const request = await loadPublicRequest(id);
  if (!request) notFound();
  const notes = request.demo && isDemoMode()
    ? getDemoBook().acknowledgements(id).map((note) => ({ id: note.id, displayName: note.displayName, giftMinor: note.giftMinor }))
    : (await listPublicGifts(id)).map((note) => ({ id: `${note.displayName}-${note.giftMinor}`, displayName: note.displayName, giftMinor: note.giftMinor }));
  const remaining = Math.max(0, request.amountNeededMinor - request.raisedMinor);
  const actor = await getActor();
  return (
    <article className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_0.7fr]">
      <div>
        <p className="text-sm font-medium text-gold">
          {categoryLabel(request.category)} · {request.county} County{request.locality ? ` · ${request.locality}` : ""}
          {request.urgent ? " · Urgent" : ""}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-4xl tracking-tight">{request.title}</h1>
          <RequestStatusPill status="published" />
        </div>
        <p className="mt-4 text-sm text-muted">Public name: {request.publicAlias}{request.demo ? " · Demonstration request" : ""}</p>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-ink-soft">{request.summary}</p>
        <dl className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className={panelClass}>
            <dt className="text-sm text-muted">Needed</dt>
            <dd className="mt-1 font-serif text-3xl">{formatKes(request.amountNeededMinor)}</dd>
          </div>
          <div className={panelClass}>
            <dt className="text-sm text-muted">Simulated gifts recorded</dt>
            <dd className="mt-1 font-serif text-3xl">{formatKes(request.raisedMinor)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-ink">
          {formatKes(remaining)} still open on this demonstration ledger.
          {request.raisedMinor >= request.amountNeededMinor && request.amountNeededMinor > 0
            ? " The simulated total has reached the requested amount. Nothing has been paid out."
            : ""}
        </p>
        <p className="mt-6 max-w-2xl text-sm leading-6 text-ink-soft">
          This page shows the published summary only. Supporting documents, review notes, and contact details are not public. A simulated gift is not money collected, and closing a request does not send money.
          {request.publishedAt ? ` Published ${request.publishedAt.slice(0, 10)}.` : ""}
        </p>
        <h2 className="mt-10 font-serif text-2xl">Public acknowledgements</h2>
        {notes.length === 0 ? <p className="mt-3 text-sm text-ink-soft">No simulated gifts yet.</p> : (
          <ul className="mt-3 space-y-2 text-sm">
            {notes.map((note, index) => (
              <li key={`${note.id}-${index}`} className="flex justify-between gap-4 border-b border-line py-2">
                <span>{note.displayName}</span>
                <span>{formatKes(note.giftMinor)} · simulated</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <aside className={panelClass}>
        <h2 className="font-serif text-2xl">Give toward this request</h2>
        <div className="mt-4">
          <ContributeForm
            requestId={request.id}
            nextPath={`/requests/${request.id}`}
            idempotencyKey={randomUUID()}
            signedIn={Boolean(actor)}
            donor={Boolean(actor?.roles.includes("donor"))}
          />
          {request.demo ? null : (
            <SandboxPaymentNotice
              requestId={request.id}
              nextPath={`/requests/${request.id}`}
              idempotencyKey={randomUUID()}
              signedIn={Boolean(actor)}
              donor={Boolean(actor?.roles.includes("donor"))}
            />
          )}
        </div>
      </aside>
    </article>
  );
}

async function loadPublicRequest(id: string): Promise<PublicRequest | null> {
  if (isDemoMode()) {
    const sample = getDemoBook().getPublicRequest(id);
    if (sample) return sample;
  }
  if (!isDatabaseConfigured()) return null;
  return readPublished(id);
}

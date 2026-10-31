import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AssistanceForm } from "@/components/forms/assistance-form";
import { RequestEvidenceForm } from "@/components/forms/evidence-picker";
import { panelClass, quietButton } from "@/components/ui/styles";
import { RequestStatusPill } from "@/components/ui/status-pill";
import { applicantCanAttachEvidence, evidenceCategoryLabel, evidenceReviewLabel } from "@/domain/evidence";
import { categoryLabel, requestStatusLabel } from "@/domain/labels";
import { formatKes } from "@/domain/money";
import { readOwnedRequest } from "@/server/assistance";
import { removeEvidenceAction } from "@/server/actions/evidence";
import { guardDashboard } from "@/server/guard";

export const metadata = { title: "Your request" };

export default function OwnedRequestPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading your request…</p>}>
      <OwnedRequest params={params} />
    </Suspense>
  );
}

async function OwnedRequest({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const actor = await guardDashboard("recipient", `/dashboard/recipient/requests/${id}`);
  const record = await readOwnedRequest(actor, id);
  if (!record) notFound();
  const { request, events, evidence } = record;
  const editable = request.status === "draft" || request.status === "needs_information";
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <Link className="text-sm font-semibold text-lagoon" href="/dashboard/recipient">Back to your requests</Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-4xl">{request.title}</h1>
        <RequestStatusPill status={request.status} />
      </div>
      <p className="mt-3 text-sm text-muted">
        {categoryLabel(request.category)} · {request.county}{request.locality ? ` · ${request.locality}` : ""} · {formatKes(request.amountNeededMinor)}
        {request.urgent ? " · Urgent" : ""}
      </p>
      <p className="mt-6 leading-7">{request.summary}</p>
      {request.applicantFeedback ? (
        <p className="mt-6 rounded-2xl bg-sand px-4 py-3 text-sm leading-6">Message from the review: {request.applicantFeedback}</p>
      ) : null}
      {request.status === "rejected" ? (
        <p className="mt-4 text-sm leading-6">
          If you want this decision looked at again, use the <Link className="font-semibold underline" href="/safeguarding">safeguarding page</Link>. Closing or rejecting a request does not delete its history.
        </p>
      ) : null}
      <section className="mt-8">
        <h2 className="font-serif text-2xl">Status history</h2>
        {events.length === 0 ? <p className="mt-3 text-sm text-ink-soft">No status change has been recorded yet.</p> : (
          <ol className="mt-3 space-y-2 text-sm">
            {events.map((event) => (
              <li key={event.id}>
                {requestStatusLabel(event.toStatus)} · {event.createdAt.slice(0, 10)}
                {event.reason ? ` · ${event.reason}` : ""}
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="mt-8">
        <h2 className="font-serif text-2xl">Your documents</h2>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          Reviewers can open these files. Donors cannot. A saved file has not been scanned, and a video length has not been measured. Verification of a file does not prove every claim in the application.
        </p>
        {request.evidenceGap ? <p className="mt-3 text-sm leading-6">Note about a missing document: {request.evidenceGap}</p> : null}
        {evidence.length === 0 ? <p className="mt-3 text-sm text-ink-soft">No document has been stored.</p> : (
          <ul className="mt-3 space-y-3 text-sm">
            {evidence.map((item) => (
              <li key={item.id} className="rounded-2xl border border-line px-4 py-3">
                {item.stored ? (
                  <a className="font-semibold text-lagoon" href={`/dashboard/recipient/requests/${request.id}/evidence/${item.id}`}>{item.fileName}</a>
                ) : item.fileName}
                <p className="text-muted">
                  {item.reviewTracked ? evidenceCategoryLabel(item.category) : "Category not recorded yet"}
                  {" · "}{item.contentType}{" · "}{item.byteSize} bytes
                  {item.reviewTracked ? ` · ${evidenceReviewLabel(item.reviewStatus)}` : ""}
                </p>
                {item.description ? <p className="mt-1">{item.description}</p> : null}
                {item.reviewTracked && item.reviewNote && (item.reviewStatus === "needs_clarification" || item.reviewStatus === "rejected") ? (
                  <p className="mt-1">Reviewer message: {item.reviewNote}</p>
                ) : null}
                {request.status === "draft" && item.reviewTracked && item.reviewStatus === "pending_review" ? (
                  <form action={removeEvidenceAction} className="mt-2">
                    <input type="hidden" name="evidenceId" value={item.id} />
                    <input type="hidden" name="returnTo" value={`/dashboard/recipient/requests/${request.id}`} />
                    <button className={quietButton} type="submit">Remove this file</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {applicantCanAttachEvidence(request.status) ? <RequestEvidenceForm requestId={request.id} /> : null}
      </section>
      {editable ? (
        <section className={`${panelClass} mt-8`}>
          <h2 className="font-serif text-2xl">{request.status === "draft" ? "Continue this draft" : "Update and submit again"}</h2>
          <div className="mt-6">
            <AssistanceForm
              clientToken={request.clientToken}
              initial={{
                category: request.category,
                preferredAssistance: request.preferredAssistance,
                title: request.title,
                summary: request.summary,
                county: request.county,
                locality: request.locality,
                amountShillings: String(request.amountNeededMinor / 100),
                publicAlias: request.publicAlias,
                reason: request.reason,
                privateNotes: request.privateNotes,
                urgent: request.urgent,
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

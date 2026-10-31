import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DecisionForm } from "@/components/admin/decision-form";
import { reviewRequestAction } from "@/server/actions/platform";
import { addReviewNoteAction, decideRequestAction, decideVerificationAction } from "@/server/actions/assistance";
import { reviewEvidenceAction } from "@/server/actions/evidence";
import { panelClass, primaryButton } from "@/components/ui/styles";
import { RequestStatusPill, VerificationStatusPill } from "@/components/ui/status-pill";
import { DomainError } from "@/domain/errors";
import { categoryLabel, requestStatusLabel, verificationStatusLabel } from "@/domain/labels";
import { evidenceCategoryLabel, evidenceReviewLabel, EVIDENCE_REVIEW_STATUSES, unverifiedEvidenceHold } from "@/domain/evidence";
import { allowedRequestTransitions } from "@/domain/requests";
import { formatKes } from "@/domain/money";
import type { Actor, RequestStatus } from "@/domain/types";
import { isDatabaseConfigured, isDemoMode } from "@/config/brand";
import { readForReview } from "@/server/assistance";
import { getDemoBook } from "@/server/book";
import { guardDashboard } from "@/server/guard";

export const metadata = { title: "Review request" };

const DECISION_LABELS: Partial<Record<RequestStatus, string>> = {
  under_review: "Start review",
  needs_information: "Ask for more information",
  verified: "Verify this request",
  rejected: "Reject request",
  published: "Publish request",
  closed: "Close request",
  suspended: "Suspend request",
};

export default function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading the review file…</p>}>
      <Review params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Review({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const { id } = await params;
  const actor = await guardDashboard("administrator", `/dashboard/admin/requests/${id}`);
  const error = (await searchParams).error;
  if (isDemoMode()) {
    let sample: ReturnType<ReturnType<typeof getDemoBook>["readRequest"]> | null = null;
    try {
      sample = getDemoBook().readRequest(actor, id);
    } catch (caught) {
      if (!(caught instanceof DomainError) || caught.code !== "not_found") throw caught;
    }
    if (sample) {
      return <DemoReview actor={actor} requestId={sample.id} title={sample.title} status={sample.status} alias={sample.publicAlias} county={sample.county} summary={sample.summary} notes={sample.privateNotes} ownerId={sample.ownerId} error={error} />;
    }
  }
  if (!isDatabaseConfigured()) notFound();
  const live = await readForReview(actor, id);
  if (!live) notFound();
  const options = allowedRequestTransitions(live.request.status).filter((status) => status !== "submitted");
  const canVerifyRequest = live.verificationStatus === "verified";
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <Link className="text-sm font-semibold text-lagoon" href="/dashboard/admin">Back to the queue</Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-4xl">{live.request.title}</h1>
        <RequestStatusPill status={live.request.status} />
      </div>
      <p className="mt-3 text-sm text-muted">
        {categoryLabel(live.request.category)} · {live.request.county}{live.request.locality ? ` · ${live.request.locality}` : ""} · {formatKes(live.request.amountNeededMinor)}
        {live.request.urgent ? " · Marked urgent" : ""}
      </p>
      <p className="mt-6 leading-7">{live.request.summary}</p>
      <section className="mt-6 rounded-3xl border border-gold/40 bg-sand p-5">
        <h2 className="font-serif text-2xl">Private review file</h2>
        <p className="mt-2 text-sm leading-6">Donors cannot open this section. Applicant verification: {verificationStatusLabel(live.verificationStatus)}.</p>
        <div className="mt-3"><VerificationStatusPill status={live.verificationStatus} /></div>
        <p className="mt-3 text-sm leading-6">Reason shared with the reviewer: {live.request.reason || "None."}</p>
        <p className="mt-3 text-sm leading-6">Private note: {live.request.privateNotes || "None."}</p>
        <p className="mt-3 text-sm leading-6">Message the applicant can see: {live.request.applicantFeedback || "None yet."}</p>
        {live.request.evidenceGap ? <p className="mt-3 text-sm leading-6">Missing document: {live.request.evidenceGap}</p> : null}
        {unverifiedEvidenceHold(live.evidence, "request") ? (
          <p className="mt-3 text-sm leading-6">{unverifiedEvidenceHold(live.evidence, "request")}</p>
        ) : null}
        <ul className="mt-3 space-y-4 text-sm">
          {live.evidence.length === 0 ? <li>No supporting document.</li> : live.evidence.map((item) => (
            <li key={item.id} className="rounded-2xl border border-line bg-paper px-4 py-3">
              {item.stored ? <a className="font-semibold text-lagoon" href={`/dashboard/admin/requests/${live.request.id}/evidence/${item.id}`}>{item.fileName}</a> : item.fileName}
              <p className="text-muted">
                {item.reviewTracked ? evidenceCategoryLabel(item.category) : "Category not recorded yet"}
                {" · "}{item.contentType}{" · "}{item.byteSize} bytes{" · "}{item.createdAt.slice(0, 10)}
                {item.reviewTracked ? ` · ${evidenceReviewLabel(item.reviewStatus)}` : " · review status not recorded yet"}
                {" · not scanned"}
              </p>
              {item.description ? <p className="mt-1">{item.description}</p> : null}
              {item.reviewNote ? <p className="mt-1">Review note: {item.reviewNote}</p> : null}
              {item.contentType.startsWith("video/") ? <p className="mt-1">Video length was not measured. Watch the file before marking it verified.</p> : null}
              {item.reviewTracked ? (
                <DecisionForm action={reviewEvidenceAction} confirm="Record this evidence review? It does not approve the whole request." label="Save evidence review" acknowledgement="Verified means I completed the checks for this file. It does not prove every claim in the application.">
                  <input type="hidden" name="requestId" value={live.request.id} />
                  <input type="hidden" name="evidenceId" value={item.id} />
                  <label className="block text-sm font-medium">Status
                    <select className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="status" defaultValue={item.reviewStatus}>
                      {EVIDENCE_REVIEW_STATUSES.map((status) => <option key={status} value={status}>{evidenceReviewLabel(status)}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-medium">What you checked, or what is still missing
                    <textarea className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="note" minLength={8} required rows={3} defaultValue={item.reviewNote} />
                  </label>
                  {item.contentType.startsWith("video/") ? (
                    <label className="flex items-start gap-2 text-sm leading-6">
                      <input className="mt-1" type="checkbox" name="watched" />
                      <span>I watched this video. The server did not measure its length.</span>
                    </label>
                  ) : null}
                </DecisionForm>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section className={`${panelClass} mt-6`}>
        <h2 className="font-serif text-2xl">Review checklist</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6">
          <li>The public text has no phone number, exact address, identity number, or medical detail.</li>
          <li>The document, if any, matches the kind of help being asked for.</li>
          <li>Verifying the applicant is a separate step from publishing the request.</li>
          <li>A concern is recorded for a person to review. It is not an automatic accusation.</li>
        </ul>
      </section>
      {error ? <p role="alert" className="mt-4 text-sm text-clay">{error}</p> : null}
      <section className="mt-6 grid gap-4">
        <h2 className="font-serif text-2xl">Applicant verification</h2>
        <p className="text-sm leading-6 text-ink-soft">This records a decision about the applicant. It does not publish the request.</p>
        {(["under_review", "verified", "needs_information", "rejected"] as const).map((outcome) => (
          <DecisionForm key={outcome} action={decideVerificationAction} confirm={`Record applicant verification as ${verificationStatusLabel(outcome)}?`} label={verificationStatusLabel(outcome)}>
            <input type="hidden" name="requestId" value={live.request.id} />
            <input type="hidden" name="profileId" value={live.request.ownerId} />
            <input type="hidden" name="to" value={outcome} />
            <label className="block text-sm font-medium">Reason
              <textarea className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="reason" minLength={8} required rows={3} />
            </label>
          </DecisionForm>
        ))}
      </section>
      <section className="mt-8 grid gap-4">
        <h2 className="font-serif text-2xl">Request decision</h2>
        {options.length === 0 ? <p className="text-sm text-ink-soft">This request has no further status change.</p> : options.map((option) => {
          if (option === "verified" && !canVerifyRequest) {
            return <p key={option} className="text-sm leading-6">Verify the applicant before verifying this request. Publishing stays unavailable until then.</p>;
          }
          return (
            <DecisionForm key={option} action={decideRequestAction} confirm={`${DECISION_LABELS[option] ?? requestStatusLabel(option)}? This does not send money.`} label={DECISION_LABELS[option] ?? requestStatusLabel(option)}>
              <input type="hidden" name="requestId" value={live.request.id} />
              <input type="hidden" name="to" value={option} />
              <label className="block text-sm font-medium">Reason the applicant may see
                <textarea className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="reason" minLength={8} required rows={3} />
              </label>
              <label className="block text-sm font-medium">Private note, optional
                <textarea className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="privateNote" rows={2} />
              </label>
            </DecisionForm>
          );
        })}
      </section>
      <DecisionForm action={addReviewNoteAction} confirm="Save this private note?" label="Save private note">
        <input type="hidden" name="requestId" value={live.request.id} />
        <label className="block text-sm font-medium">Private administrative note
          <textarea className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="body" minLength={8} required rows={3} />
        </label>
      </DecisionForm>
      <section className="mt-8">
        <h2 className="font-serif text-2xl">Status history</h2>
        <ol className="mt-3 space-y-2 text-sm">
          {live.events.map((event) => (
            <li key={event.id}>{requestStatusLabel(event.toStatus)} · {event.createdAt.slice(0, 10)}{event.reason ? ` · ${event.reason}` : ""}</li>
          ))}
        </ol>
        {live.notes.length > 0 ? (
          <ul className="mt-4 space-y-2 text-sm">
            {live.notes.map((note) => <li key={note.id} className="rounded-2xl bg-sand px-4 py-3">Private note · {note.createdAt.slice(0, 10)} · {note.body}</li>)}
          </ul>
        ) : null}
      </section>
    </article>
  );
}

function DemoReview(props: {
  actor: Actor;
  requestId: string;
  title: string;
  status: RequestStatus;
  alias: string;
  county: string;
  summary: string;
  notes: string;
  ownerId: string;
  error?: string;
}) {
  const book = getDemoBook();
  const evidence = book.readEvidence(props.actor, props.requestId);
  const verification = book.verificationFor(props.ownerId);
  const options = allowedRequestTransitions(props.status).filter((status) => status !== "submitted");
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold text-gold">Demonstration request</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-4xl">{props.title}</h1>
        <RequestStatusPill status={props.status} />
      </div>
      <p className="mt-3 text-sm text-muted">Public name {props.alias} · {props.county}</p>
      <p className="mt-6 leading-7">{props.summary}</p>
      <section className="mt-6 rounded-3xl border border-gold/40 bg-sand p-5">
        <h2 className="font-serif text-2xl">Private review file</h2>
        <p className="mt-2 text-sm leading-6">Identity verification: {verification?.status ?? "not started"}. This sample file is not a live application.</p>
        <p className="mt-3 text-sm leading-6">{props.notes || "No private note."}</p>
        <ul className="mt-3 text-sm">
          {evidence.length === 0 ? <li>No evidence metadata.</li> : evidence.map((item) => (
            <li key={item.id}>{item.fileName} · stored file: {item.storageKey ?? "not retained"}</li>
          ))}
        </ul>
      </section>
      {props.error ? <p role="alert" className="mt-4 text-sm text-clay">{props.error}</p> : null}
      {options.length > 0 ? (
        <form action={reviewRequestAction} className={`${panelClass} mt-6 space-y-4`}>
          <input type="hidden" name="requestId" value={props.requestId} />
          <label className="block text-sm font-medium">Decision
            <select className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="to" defaultValue={options[0]}>
              {options.map((status) => <option key={status} value={status}>{requestStatusLabel(status)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Reason
            <textarea className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="reason" minLength={8} required rows={4} />
          </label>
          <button className={primaryButton} type="submit">Record decision</button>
        </form>
      ) : <p className="mt-6 text-sm text-ink-soft">This request has no further status change.</p>}
    </article>
  );
}

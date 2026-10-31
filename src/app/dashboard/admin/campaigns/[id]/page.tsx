import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";

import { DecisionForm } from "@/components/admin/decision-form";
import { CampaignDraftForm } from "@/components/forms/campaign-draft-form";
import { CampaignEvidenceForm } from "@/components/forms/evidence-picker";
import { CampaignStatusPill } from "@/components/ui/status-pill";
import { panelClass, quietButton } from "@/components/ui/styles";
import { allowedCampaignTransitions } from "@/domain/campaigns";
import { campaignCanAttachEvidence, evidenceCategoryLabel, evidenceReviewLabel, EVIDENCE_REVIEW_STATUSES, unverifiedEvidenceHold } from "@/domain/evidence";
import { campaignStatusLabel } from "@/domain/labels";
import { formatKes } from "@/domain/money";
import type { CampaignStatus } from "@/domain/types";
import { publishCampaignReportAction, recordSelectionAction, transitionCampaignAction } from "@/server/actions/campaigns";
import { removeEvidenceAction, reviewEvidenceAction } from "@/server/actions/evidence";
import { campaignCategoryLabel, readAdminCampaign, type AdminCampaign } from "@/server/campaigns";
import { listCampaignEvidence } from "@/server/private-evidence";
import { guardDashboard } from "@/server/guard";

export const metadata = { title: "Campaign review" };

export default function AdminCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading campaign…</p>}>
      <AdminCampaign params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function nairobiInput(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function nextActions(campaign: AdminCampaign): CampaignStatus[] {
  const now = Date.now();
  const starts = new Date(campaign.startsAt).getTime();
  const ends = new Date(campaign.endsAt).getTime();
  return allowedCampaignTransitions(campaign.status).filter((status) => {
    switch (status) {
      case "scheduled":
        return starts > now;
      case "active":
        return campaign.status === "scheduled" ? starts <= now : starts <= now && ends > now;
      case "cancelled":
        return campaign.status === "scheduled" || campaign.status === "active" ? campaign.cancellationAllowed : true;
      case "reported":
        return false;
      case "draft":
      case "under_review":
      case "approved":
      case "closed":
      case "reconciling":
        return true;
      default: {
        const unexpected: never = status;
        return unexpected;
      }
    }
  });
}

function actionLabel(status: CampaignStatus): string {
  switch (status) {
    case "under_review":
      return "Send for review";
    case "approved":
      return "Approve";
    case "draft":
      return "Return to draft";
    case "scheduled":
      return "Schedule";
    case "active":
      return "Open the campaign";
    case "closed":
      return "Close campaign";
    case "cancelled":
      return "Cancel campaign";
    case "reconciling":
      return "Start reconciliation";
    case "reported":
      return "Publish report";
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}

async function AdminCampaign({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const actor = await guardDashboard("administrator", "/dashboard/admin/campaigns");
  const { id } = await params;
  const error = (await searchParams).error;
  const campaign = await readAdminCampaign(actor, id);
  if (!campaign) notFound();
  const evidence = await listCampaignEvidence(actor, id);
  const hold = unverifiedEvidenceHold(evidence, "campaign");
  const actions = nextActions(campaign);
  const canSelect = !campaign.selection && (campaign.status === "active" || campaign.status === "closed" || campaign.status === "reconciling");
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm text-gold">{campaignCategoryLabel(campaign.category)} · {campaign.county}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-4xl">{campaign.title}</h1>
        <CampaignStatusPill status={campaign.status} />
      </div>
      {error ? <p role="alert" className="mt-4 text-sm text-clay">{error}</p> : null}
      <p className="mt-4 text-sm">
        <Link className="font-semibold text-lagoon" href={`/campaigns/${campaign.slug}`}>Public page</Link>
      </p>
      <dl className={`${panelClass} mt-6 grid gap-3 text-sm sm:grid-cols-2`}>
        <div><dt className="text-muted">Target</dt><dd className="font-semibold">{formatKes(campaign.targetMinor)}</dd></div>
        <div><dt className="text-muted">Simulated net from the ledger</dt><dd className="font-semibold">{formatKes(campaign.raisedMinor)}</dd></div>
        <div><dt className="text-muted">Gifts still counting</dt><dd className="font-semibold">{campaign.contributionCount}</dd></div>
        <div><dt className="text-muted">Platform fee shown to donors</dt><dd className="font-semibold">KSh 0</dd></div>
        <div><dt className="text-muted">Opens</dt><dd className="font-semibold">{nairobiInput(campaign.startsAt).replace("T", " ")}</dd></div>
        <div><dt className="text-muted">Closes</dt><dd className="font-semibold">{nairobiInput(campaign.endsAt).replace("T", " ")}</dd></div>
      </dl>
      <section className="mt-8 space-y-4 text-sm leading-6">
        <h2 className="font-serif text-2xl">Published rules</h2>
        <p><span className="font-semibold">Beneficiary group. </span>{campaign.beneficiaryGroup}</p>
        <p><span className="font-semibold">Eligibility. </span>{campaign.eligibilityCriteria}</p>
        <p><span className="font-semibold">Selection method. </span>{campaign.selectionRules}</p>
        <p><span className="font-semibold">Fee policy. </span>{campaign.feeDisclosure}</p>
        <p><span className="font-semibold">Refund policy. </span>{campaign.refundPolicy}</p>
        <p><span className="font-semibold">Surplus policy. </span>{campaign.surplusPolicy}</p>
        <p><span className="font-semibold">Cancellation. </span>{campaign.cancellationAllowed ? "Allowed by the published policy." : "Not allowed after the campaign is scheduled or active."}</p>
      </section>
      <section className="mt-8">
        <h2 className="font-serif text-2xl">Private evidence</h2>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          These files are not on the public page. No malware scanner is configured. Video length is not measured. Marking a file verified means the reviewer checked that file. It does not approve the campaign or send money.
        </p>
        {hold ? <p className="mt-3 text-sm leading-6">{hold}</p> : null}
        {evidence.length === 0 ? <p className="mt-3 text-sm text-ink-soft">No private file is attached. A campaign with no private file can still be approved by a person.</p> : (
          <ul className="mt-4 space-y-4 text-sm">
            {evidence.map((item) => (
              <li key={item.id} className="rounded-2xl border border-line px-4 py-3">
                {item.stored ? <a className="font-semibold text-lagoon" href={`/dashboard/admin/campaigns/${campaign.id}/evidence/${item.id}`}>{item.fileName}</a> : item.fileName}
                <p className="text-muted">
                  {item.reviewTracked ? `${evidenceCategoryLabel(item.category)} · ${evidenceReviewLabel(item.reviewStatus)}` : "Review status is not recorded yet"}
                  {" · "}{item.contentType}{" · "}{item.byteSize} bytes{" · "}{item.createdAt.slice(0, 10)}{" · not scanned"}
                </p>
                {item.description ? <p className="mt-1">{item.description}</p> : null}
                {item.reviewNote ? <p className="mt-1">Review note: {item.reviewNote}</p> : null}
                {item.reviewTracked && item.reviewStatus === "pending_review" && campaignCanAttachEvidence(campaign.status) ? (
                  <form action={removeEvidenceAction} className="mt-2">
                    <input type="hidden" name="evidenceId" value={item.id} />
                    <input type="hidden" name="returnTo" value={`/dashboard/admin/campaigns/${campaign.id}`} />
                    <button className={quietButton} type="submit">Remove pending file</button>
                  </form>
                ) : null}
                {item.reviewTracked ? (
                  <DecisionForm action={reviewEvidenceAction} confirm="Record this evidence review? It does not approve the campaign." label="Save evidence review" acknowledgement="Verified means I completed the checks for this file. It does not prove the campaign.">
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="evidenceId" value={item.id} />
                    <label className="block text-sm font-medium">Status
                      <select className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="status" defaultValue={item.reviewStatus}>
                        {EVIDENCE_REVIEW_STATUSES.map((status) => <option key={status} value={status}>{evidenceReviewLabel(status)}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm font-medium">What you checked
                      <textarea className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="note" minLength={8} required rows={3} />
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
        )}
        {campaignCanAttachEvidence(campaign.status) ? <CampaignEvidenceForm campaignId={campaign.id} /> : null}
      </section>
      {campaign.status === "draft" ? (
        <section className="mt-10">
          <h2 className="font-serif text-2xl">Edit draft</h2>
          <div className="mt-4">
            <CampaignDraftForm
              campaignId={campaign.id}
              defaults={{
                title: campaign.title,
                slug: campaign.slug,
                category: campaign.category,
                objective: campaign.objective,
                amountShillings: String(campaign.targetMinor / 100),
                startsAt: nairobiInput(campaign.startsAt),
                endsAt: nairobiInput(campaign.endsAt),
                county: campaign.county,
                beneficiaryGroup: campaign.beneficiaryGroup,
                eligibilityCriteria: campaign.eligibilityCriteria,
                selectionRules: campaign.selectionRules,
                feeDisclosure: campaign.feeDisclosure,
                refundPolicy: campaign.refundPolicy,
                surplusPolicy: campaign.surplusPolicy,
                cancellationAllowed: campaign.cancellationAllowed,
                imagePath: campaign.imagePath,
              }}
            />
          </div>
        </section>
      ) : null}
      {actions.length > 0 ? (
        <section className="mt-10 space-y-4">
          <h2 className="font-serif text-2xl">Decisions</h2>
          {actions.map((status) => (
            <DecisionForm
              key={status}
              action={transitionCampaignAction}
              confirm={`Record this campaign as ${campaignStatusLabel(status)}? This does not send money.`}
              label={actionLabel(status)}
              acknowledgement="I have checked the campaign rules and I want this decision recorded."
            >
              <input type="hidden" name="campaignId" value={campaign.id} />
              <input type="hidden" name="nextStatus" value={status} />
              <label className="block text-sm font-medium">
                Reason
                <textarea className="mt-1.5 w-full rounded-xl border border-line px-3 py-2" name="reason" minLength={8} required />
              </label>
            </DecisionForm>
          ))}
        </section>
      ) : null}
      {canSelect ? (
        <section className="mt-10">
          <h2 className="font-serif text-2xl">Manual selection</h2>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            Record the decision once. It cannot be replaced to produce a different outcome. Keep names, phone numbers, and medical details out of this summary.
          </p>
          <div className="mt-4">
            <DecisionForm
              action={recordSelectionAction}
              confirm="Record this selection once? It cannot be rerun."
              label="Record selection"
              acknowledgement="I have followed the published eligibility rules and I want this selection recorded."
            >
              <input type="hidden" name="campaignId" value={campaign.id} />
              <label className="block text-sm font-medium">Private reference to the eligible set
                <input className="mt-1.5 w-full rounded-xl border border-line px-3 py-2" name="eligibleReference" minLength={8} maxLength={500} required />
              </label>
              <label className="block text-sm font-medium">Public-safe outcome summary
                <textarea className="mt-1.5 w-full rounded-xl border border-line px-3 py-2" name="outcomeSummary" minLength={8} maxLength={800} required />
              </label>
              <label className="block text-sm font-medium">Amount allocated, in shillings
                <input className="mt-1.5 w-full rounded-xl border border-line px-3 py-2" name="allocatedShillings" inputMode="numeric" min={0} step={1} required />
              </label>
            </DecisionForm>
          </div>
        </section>
      ) : null}
      {campaign.selection ? (
        <section className={`${panelClass} mt-8`}>
          <h2 className="font-serif text-2xl">Selection record</h2>
          <p className="mt-2 text-sm">Manual · {formatKes(campaign.selection.allocatedMinor)} allocated by decision · {campaign.selection.createdAt.slice(0, 16).replace("T", " ")}</p>
          <p className="mt-2 text-sm leading-6">{campaign.selection.outcomeSummary}</p>
          <p className="mt-2 text-sm text-muted">Private reference: {campaign.selection.eligibleReference}</p>
        </section>
      ) : null}
      {campaign.reconciliation ? (
        <section className={`${panelClass} mt-8`}>
          <h2 className="font-serif text-2xl">Reconciliation</h2>
          <p className="mt-2 text-sm">Net {formatKes(campaign.reconciliation.netMinor)} · {campaign.reconciliation.contributionCount} gifts still counting · Funds sent: no</p>
          <p className="mt-2 text-sm leading-6">{campaign.reconciliation.unresolvedNotes}</p>
          <p className="mt-2 text-sm leading-6"><span className="font-semibold">Surplus policy on record. </span>{campaign.reconciliation.surplusNote}</p>
        </section>
      ) : null}
      {campaign.status === "reconciling" ? (
        <section className="mt-10">
          <h2 className="font-serif text-2xl">Public report</h2>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            The amounts are copied from the ledger. Say what was raised, what was allocated, and that nothing has been paid unless a verified payment exists. Leave out phone numbers, emails, and account numbers.
          </p>
          <div className="mt-4">
            <DecisionForm
              action={publishCampaignReportAction}
              confirm="Publish this report? The amounts come from the ledger and cannot be typed in."
              label="Publish report"
              acknowledgement="I have checked the ledger totals and I want this report published."
            >
              <input type="hidden" name="campaignId" value={campaign.id} />
              <textarea className="w-full rounded-xl border border-line px-3 py-2" name="narrative" minLength={40} maxLength={4000} required rows={5} />
            </DecisionForm>
          </div>
        </section>
      ) : null}
      {campaign.report ? (
        <section className={`${panelClass} mt-8`}>
          <h2 className="font-serif text-2xl">Report preview</h2>
          <p className="mt-2 text-sm leading-6">{campaign.report.narrative}</p>
          <p className="mt-2 text-sm">Raised {formatKes(campaign.report.raisedMinor)} · Fee {formatKes(campaign.report.platformFeeMinor)} · Allocated {formatKes(campaign.report.allocatedMinor)} · Paid {formatKes(campaign.report.paidMinor)}</p>
        </section>
      ) : null}
      <section className="mt-10">
        <h2 className="font-serif text-2xl">Audit history</h2>
        <ol className="mt-4 space-y-3 text-sm">
          {campaign.events.map((event) => (
            <li key={event.id}>
              <span className="font-semibold">{event.fromStatus ? campaignStatusLabel(event.fromStatus) : "Created"} → {campaignStatusLabel(event.toStatus)}</span>
              <span className="text-muted"> · {event.createdAt.slice(0, 16).replace("T", " ")}</span>
              <p className="text-ink-soft">{event.reason}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

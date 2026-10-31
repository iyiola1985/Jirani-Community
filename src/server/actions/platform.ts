"use server";

import { randomUUID } from "node:crypto";
import { redirect, unstable_rethrow } from "next/navigation";

import { isDatabaseConfigured } from "@/config/brand";
import { getMockProviderSecret } from "@/config/secrets";
import { COUNTIES } from "@/data/counties";
import { DomainError } from "@/domain/errors";
import { getActor } from "@/server/session";
import { MockPaymentProvider } from "@/domain/payments";
import type { Complaint, RequestStatus } from "@/domain/types";
import { validateRequestForm } from "@/domain/validation";
import { findDemoActor } from "@/server/accounts";
import { readPublished } from "@/server/assistance";
import { getDemoBook } from "@/server/book";
import { evidenceFromForm } from "@/server/evidence-form";
import { toFormError, type FormState } from "@/server/form-state";
import {
  readOwnContribution,
  recordSimulatedCampaignContribution,
  recordSimulatedContribution,
  reverseSimulatedContribution,
  settleSimulatedContribution,
} from "@/server/ledger";
import { readCampaignTarget } from "@/server/campaigns";

async function signedIn() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

function message(error: unknown, fallback: string): string {
  return error instanceof DomainError ? error.message : fallback;
}

export async function submitRequestAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await signedIn();
  if (!actor.roles.includes("recipient")) {
    return { error: "Only a recipient account can submit a request.", notice: null, fieldErrors: {} };
  }
  const parsed = validateRequestForm(
    {
      category: String(formData.get("category") ?? ""),
      title: String(formData.get("title") ?? ""),
      summary: String(formData.get("summary") ?? ""),
      county: String(formData.get("county") ?? ""),
      amountShillings: String(formData.get("amountShillings") ?? ""),
      publicAlias: String(formData.get("publicAlias") ?? ""),
      privateNotes: String(formData.get("privateNotes") ?? ""),
      acceptedPublication: formData.get("acceptedPublication") === "on",
    },
    COUNTIES,
  );
  if (!parsed.ok) return { error: "Check the form and try again.", notice: null, fieldErrors: parsed.errors };
  const evidence = await evidenceFromForm(formData);
  if ("error" in evidence) return { error: evidence.error, notice: null, fieldErrors: {} };

  try {
    const book = getDemoBook();
    const { amountMinor, ...requestFields } = parsed.value;
    const { request } = book.submitRequest({
      actor,
      request: { ...requestFields, amountNeededMinor: amountMinor, demo: true },
    });
    for (const file of evidence) {
      book.addEvidenceMetadata({
        actor,
        requestId: request.id,
        fileName: file.fileName,
        contentType: file.contentType,
        byteSize: file.bytes.byteLength,
        sha256: file.sha256,
      });
    }
    redirect("/dashboard/recipient");
  } catch (error) {
    unstable_rethrow(error);
    return toFormError(error);
  }
}

export async function reviewRequestAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const requestId = String(formData.get("requestId") ?? "");
  const to = String(formData.get("to") ?? "") as RequestStatus;
  const reason = String(formData.get("reason") ?? "");
  try {
    getDemoBook().reviewRequest({ actor, requestId, to, reason });
  } catch (error) {
    unstable_rethrow(error);
    redirect(`/dashboard/admin/requests/${requestId}?error=${encodeURIComponent(message(error, "The decision was not recorded."))}`);
  }
  redirect(`/dashboard/admin/requests/${requestId}`);
}

export async function closeCampaignAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const campaignId = String(formData.get("campaignId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    getDemoBook().closeCampaign(actor, campaignId, reason);
  } catch (error) {
    unstable_rethrow(error);
    redirect(`/dashboard/admin/campaigns?error=${encodeURIComponent(message(error, "The campaign was not closed."))}`);
  }
  redirect("/dashboard/admin/campaigns");
}

export async function reconcileCampaignAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const campaignId = String(formData.get("campaignId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    getDemoBook().startReconciliation(actor, campaignId, reason);
  } catch (error) {
    unstable_rethrow(error);
    redirect(`/dashboard/admin/reconciliation?error=${encodeURIComponent(message(error, "Reconciliation did not start."))}`);
  }
  redirect("/dashboard/admin/reconciliation");
}

export async function approveDisbursementAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const campaignId = String(formData.get("campaignId") ?? "");
  const beneficiaryOwnerId = String(formData.get("beneficiaryOwnerId") ?? "") || null;
  const amountShillings = Number(formData.get("amountShillings"));
  const reason = String(formData.get("reason") ?? "");
  try {
    if (!Number.isInteger(amountShillings) || amountShillings < 1) {
      throw new DomainError("validation", "Enter a whole number of shillings.");
    }
    getDemoBook().approveDisbursement({
      actor,
      campaignId,
      beneficiaryOwnerId,
      amountMinor: amountShillings * 100,
      reason,
    });
  } catch (error) {
    unstable_rethrow(error);
    redirect(`/dashboard/admin/reconciliation?error=${encodeURIComponent(message(error, "The approval was not recorded."))}`);
  }
  redirect("/dashboard/admin/reconciliation");
}

export async function publishReportAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const campaignId = String(formData.get("campaignId") ?? "");
  const narrative = String(formData.get("narrative") ?? "");
  try {
    getDemoBook().publishReport(actor, campaignId, narrative);
  } catch (error) {
    unstable_rethrow(error);
    redirect(`/dashboard/admin/reconciliation?error=${encodeURIComponent(message(error, "The report was not published."))}`);
  }
  redirect("/transparency");
}

export async function startContributionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await getActor();
  const nextPath = String(formData.get("next") ?? "/requests");
  if (!actor) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!actor.roles.includes("donor")) {
    return { error: "Sign in with a donor account to record a simulated gift.", notice: null, fieldErrors: {} };
  }
  const shillings = Number(formData.get("amountShillings"));
  const recognition = formData.get("recognition") === "public" ? "public" : "anonymous";
  const requestId = String(formData.get("requestId") ?? "");
  const campaignId = String(formData.get("campaignId") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") || randomUUID());
  try {
    if (!Number.isInteger(shillings)) throw new DomainError("validation", "Enter a whole number of shillings.");
    if (requestId && isDatabaseConfigured()) {
      const published = await readPublished(requestId);
      if (published && !published.demo) {
        if (findDemoActor(actor.id)) {
          return {
            error: "Demonstration accounts keep sample gifts in the labelled ledger. Sign in with a registered donor account to record a simulated gift on this request.",
            notice: null,
            fieldErrors: {},
          };
        }
        const contribution = await recordSimulatedContribution({
          actor,
          requestId,
          shillings,
          recognition,
          publicName: String(formData.get("publicName") ?? ""),
          idempotencyKey,
        });
        redirect(`/dashboard/donor/contributions/${contribution.id}`);
      }
    }
    if (campaignId && !requestId && isDatabaseConfigured()) {
      const campaign = await readCampaignTarget(campaignId);
      if (campaign && !campaign.demo) {
        if (findDemoActor(actor.id)) {
          return {
            error: "Demonstration accounts keep sample gifts in the labelled ledger. Sign in with a registered donor account to record a simulated gift on this campaign.",
            notice: null,
            fieldErrors: {},
          };
        }
        const contribution = await recordSimulatedCampaignContribution({
          actor,
          campaignId: campaign.id,
          shillings,
          recognition,
          publicName: String(formData.get("publicName") ?? ""),
          idempotencyKey,
        });
        redirect(`/dashboard/donor/contributions/${contribution.id}`);
      }
    }
    const contribution = getDemoBook().startContribution({
      actor,
      requestId: requestId || undefined,
      campaignId: campaignId || undefined,
      giftMinor: shillings * 100,
      recognition,
      publicName: String(formData.get("publicName") ?? ""),
      idempotencyKey,
    });
    redirect(`/dashboard/donor/contributions/${contribution.id}`);
  } catch (error) {
    unstable_rethrow(error);
    return toFormError(error);
  }
}

export async function simulateCallbackAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const contributionId = String(formData.get("contributionId") ?? "");
  const outcome = formData.get("outcome") === "failed" ? "failed" : "successful";
  try {
    if (isDatabaseConfigured()) {
      const stored = await readOwnContribution(actor, contributionId);
      if (stored) {
        const provider = new MockPaymentProvider(getMockProviderSecret());
        provider.seedSettled({
          providerReference: stored.providerReference,
          idempotencyKey: stored.id,
          amountMinor: stored.giftMinor,
          status: "pending",
          clientReference: stored.id,
        });
        const payload = {
          providerEventId: randomUUID(),
          providerReference: stored.providerReference,
          reportedStatus: outcome,
          amountMinor: stored.giftMinor,
        } as const;
        const callback = provider.handleCallback({ ...payload, signature: provider.signCallback(payload) });
        if (!callback.accepted || callback.status !== outcome) {
          throw new DomainError("payment", callback.reason);
        }
        const verified = provider.verifyStatus(stored.providerReference);
        if (verified.status !== outcome || verified.amountMinor !== stored.giftMinor) {
          throw new DomainError("payment", "Refused to record a status the simulator did not confirm.");
        }
        await settleSimulatedContribution({
          actor,
          contributionId,
          outcome,
          providerEventId: payload.providerEventId,
        });
        redirect(`/dashboard/donor/contributions/${contributionId}`);
      }
    }
    const book = getDemoBook();
    const contribution = book.readContribution(actor, contributionId);
    const payload = {
      providerEventId: randomUUID(),
      providerReference: contribution.providerReference,
      reportedStatus: outcome,
      amountMinor: contribution.donorPaysMinor,
    } as const;
    book.applyProviderCallback({ ...payload, signature: book.signSimulation(payload) });
  } catch (error) {
    unstable_rethrow(error);
    redirect(`/dashboard/donor/contributions/${contributionId}?error=${encodeURIComponent(message(error, "The simulator did not accept that callback."))}`);
  }
  redirect(`/dashboard/donor/contributions/${contributionId}`);
}

export async function reverseLedgerAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const contributionId = String(formData.get("contributionId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const shillings = Number(formData.get("amountShillings"));
  if (formData.get("confirmed") !== "on") {
    redirect("/dashboard/admin/finance?error=Confirm%20the%20reversal%20before%20it%20is%20recorded.");
  }
  try {
    await reverseSimulatedContribution({
      actor,
      contributionId,
      shillings,
      reason,
      idempotencyKey: String(formData.get("idempotencyKey") || randomUUID()),
    });
  } catch (error) {
    unstable_rethrow(error);
    redirect(`/dashboard/admin/finance?error=${encodeURIComponent(message(error, "The reversal was not recorded."))}`);
  }
  redirect("/dashboard/admin/finance");
}

export async function refundAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const contributionId = String(formData.get("contributionId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    const book = getDemoBook();
    const contribution = book.readContribution(actor, contributionId);
    book.refundContribution({
      actor,
      contributionId,
      amountMinor: contribution.netToCauseMinor,
      reason,
      idempotencyKey: randomUUID(),
    });
  } catch (error) {
    unstable_rethrow(error);
    redirect(`/dashboard/admin/reconciliation?error=${encodeURIComponent(message(error, "The reversal was not recorded."))}`);
  }
  redirect("/dashboard/admin/reconciliation");
}

export async function complaintAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await getActor();
  const subjectType = String(formData.get("subjectType") ?? "platform") as Complaint["subjectType"];
  const body = String(formData.get("body") ?? "");
  try {
    const complaint = getDemoBook().fileComplaint({ actor, subjectType, body });
    return {
      error: null,
      notice: `Reference ${complaint.id}. A reviewer can see this in the administrator dashboard. It is held in the demonstration session until the server restarts.`,
      fieldErrors: {},
    };
  } catch (error) {
    unstable_rethrow(error);
    return toFormError(error);
  }
}

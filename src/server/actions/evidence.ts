"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { DomainError } from "@/domain/errors";
import { addRequestEvidence } from "@/server/assistance";
import { addCampaignEvidence } from "@/server/campaigns";
import { evidenceFromForm, gapFromForm } from "@/server/evidence-form";
import { type FormState } from "@/server/form-state";
import { evidenceForActor, evidenceFailure, listCampaignEvidence, removePendingEvidence, reviewPrivateEvidence } from "@/server/private-evidence";
import { allowRequest } from "@/server/rate-limit";
import { getActor } from "@/server/session";

async function signedIn() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function addRequestEvidenceAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await signedIn();
  const requestId = String(formData.get("requestId") ?? "");
  if (!actor.roles.includes("recipient")) {
    return { error: "Only a recipient account can add documents.", notice: null, fieldErrors: {} };
  }
  const evidence = await evidenceFromForm(formData);
  if ("error" in evidence) return { error: evidence.error, notice: null, fieldErrors: {} };
  const evidenceGap = gapFromForm(formData);
  if (typeof evidenceGap !== "string") return { error: evidenceGap.error, notice: null, fieldErrors: {} };
  if (evidence.length > 0 && !allowRequest(`evidence:${actor.id}`, 12, 10 * 60 * 1000)) {
    return { error: "Too many uploads from this account. Wait a few minutes and try again.", notice: null, fieldErrors: {} };
  }
  try {
    await addRequestEvidence({ actor, requestId, evidence, evidenceGap });
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof DomainError ? error.message : evidenceFailure(error).message;
    return { error: message, notice: null, fieldErrors: {} };
  }
  redirect(`/dashboard/recipient/requests/${requestId}`);
}

export async function addCampaignEvidenceAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await signedIn();
  const campaignId = String(formData.get("campaignId") ?? "");
  if (!actor.roles.includes("administrator")) redirect("/unauthorized");
  const evidence = await evidenceFromForm(formData);
  if ("error" in evidence) return { error: evidence.error, notice: null, fieldErrors: {} };
  if (evidence.length === 0) return { error: "Choose a file to add.", notice: null, fieldErrors: {} };
  if (!allowRequest(`evidence:${actor.id}`, 12, 10 * 60 * 1000)) {
    return { error: "Too many uploads from this account. Wait a few minutes and try again.", notice: null, fieldErrors: {} };
  }
  try {
    await addCampaignEvidence({ actor, campaignId, evidence });
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof DomainError ? error.message : evidenceFailure(error).message;
    return { error: message, notice: null, fieldErrors: {} };
  }
  redirect(`/dashboard/admin/campaigns/${campaignId}`);
}

export async function removeEvidenceAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const evidenceId = String(formData.get("evidenceId") ?? "");
  const back = String(formData.get("returnTo") ?? "/dashboard");
  try {
    await removePendingEvidence(actor, evidenceId);
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof DomainError ? error.message : "The file was not removed.";
    redirect(`${back}?error=${encodeURIComponent(message)}`);
  }
  redirect(back);
}

export async function reviewEvidenceAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const evidenceId = String(formData.get("evidenceId") ?? "");
  const requestId = String(formData.get("requestId") ?? "");
  const campaignId = String(formData.get("campaignId") ?? "");
  const back = requestId ? `/dashboard/admin/requests/${requestId}` : `/dashboard/admin/campaigns/${campaignId}`;
  if (!actor.roles.includes("administrator")) redirect("/unauthorized");
  if (formData.get("confirmed") !== "on") {
    redirect(`${back}?error=${encodeURIComponent("Confirm the evidence decision before it is recorded.")}`);
  }
  try {
    const record = requestId
      ? await evidenceForActor(actor, requestId, evidenceId)
      : (await listCampaignEvidence(actor, campaignId)).find((item) => item.id === evidenceId) ?? null;
    if (!record || !record.reviewTracked) {
      redirect(`${back}?error=${encodeURIComponent("That file is not available for review.")}`);
    }
    await reviewPrivateEvidence({
      actor,
      evidenceId,
      ownerId: record.ownerId,
      contentType: record.contentType,
      next: String(formData.get("status") ?? ""),
      note: String(formData.get("note") ?? ""),
      watcherConfirmed: formData.get("watched") === "on",
    });
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof DomainError ? error.message : "The evidence review was not recorded.";
    redirect(`${back}?error=${encodeURIComponent(message)}`);
  }
  redirect(back);
}

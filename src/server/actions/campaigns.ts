"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { validateCampaignDraft } from "@/domain/campaign-form";
import { DomainError } from "@/domain/errors";
import { CAMPAIGN_STATUSES } from "@/domain/types";
import {
  publishCampaignReport,
  recordCampaignSelection,
  saveCampaign,
  transitionCampaignRecord,
} from "@/server/campaigns";
import { storeCampaignImage } from "@/server/campaign-images";
import { toFormError, type FormState } from "@/server/form-state";
import { getActor } from "@/server/session";

function message(error: unknown, fallback: string): string {
  return error instanceof DomainError ? error.message : fallback;
}

async function administrator() {
  const actor = await getActor();
  if (!actor) redirect("/login?next=/dashboard/admin/campaigns");
  if (!actor.roles.includes("administrator")) {
    redirect("/dashboard/admin/campaigns?error=Only%20an%20administrator%20can%20manage%20a%20campaign.");
  }
  return actor;
}

export async function saveCampaignAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await administrator();
  const currentId = String(formData.get("campaignId") ?? "").trim();
  try {
    const draft = validateCampaignDraft({
      title: String(formData.get("title") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      category: String(formData.get("category") ?? ""),
      objective: String(formData.get("objective") ?? ""),
      amountShillings: String(formData.get("amountShillings") ?? ""),
      startsAt: String(formData.get("startsAt") ?? ""),
      endsAt: String(formData.get("endsAt") ?? ""),
      county: String(formData.get("county") ?? ""),
      beneficiaryGroup: String(formData.get("beneficiaryGroup") ?? ""),
      eligibilityCriteria: String(formData.get("eligibilityCriteria") ?? ""),
      selectionRules: String(formData.get("selectionRules") ?? ""),
      feeDisclosure: String(formData.get("feeDisclosure") ?? ""),
      refundPolicy: String(formData.get("refundPolicy") ?? ""),
      surplusPolicy: String(formData.get("surplusPolicy") ?? ""),
      cancellationAllowed: formData.get("cancellationAllowed") === "on",
    });
    const upload = formData.get("image");
    const existing = String(formData.get("existingImage") ?? "");
    const imagePath =
      upload instanceof File && upload.size > 0
        ? await storeCampaignImage(upload)
        : existing.startsWith("/campaign-images/")
          ? existing
          : null;
    const id = await saveCampaign({
      actor,
      campaignId: currentId || null,
      draft,
      imagePath,
    });
    redirect(`/dashboard/admin/campaigns/${id}`);
  } catch (error) {
    unstable_rethrow(error);
    return toFormError(error);
  }
}

export async function transitionCampaignAction(formData: FormData): Promise<void> {
  const actor = await administrator();
  const campaignId = String(formData.get("campaignId") ?? "");
  const back = `/dashboard/admin/campaigns/${campaignId}`;
  const nextStatus = CAMPAIGN_STATUSES.find((status) => status === String(formData.get("nextStatus") ?? ""));
  const reason = String(formData.get("reason") ?? "");
  if (formData.get("confirmed") !== "on" || !nextStatus) {
    redirect(`${back}?error=${encodeURIComponent("Confirm the decision before it is recorded.")}`);
  }
  try {
    await transitionCampaignRecord({ actor, campaignId, nextStatus, reason });
  } catch (error) {
    unstable_rethrow(error);
    redirect(`${back}?error=${encodeURIComponent(message(error, "The campaign was not updated."))}`);
  }
  redirect(back);
}

export async function recordSelectionAction(formData: FormData): Promise<void> {
  const actor = await administrator();
  const campaignId = String(formData.get("campaignId") ?? "");
  const back = `/dashboard/admin/campaigns/${campaignId}`;
  if (formData.get("confirmed") !== "on") {
    redirect(`${back}?error=${encodeURIComponent("Confirm the selection before it is recorded.")}`);
  }
  try {
    await recordCampaignSelection({
      actor,
      campaignId,
      eligibleReference: String(formData.get("eligibleReference") ?? ""),
      outcomeSummary: String(formData.get("outcomeSummary") ?? ""),
      allocatedShillings: Number(formData.get("allocatedShillings")),
    });
  } catch (error) {
    unstable_rethrow(error);
    redirect(`${back}?error=${encodeURIComponent(message(error, "The selection was not recorded."))}`);
  }
  redirect(back);
}

export async function publishCampaignReportAction(formData: FormData): Promise<void> {
  const actor = await administrator();
  const campaignId = String(formData.get("campaignId") ?? "");
  const back = `/dashboard/admin/campaigns/${campaignId}`;
  if (formData.get("confirmed") !== "on") {
    redirect(`${back}?error=${encodeURIComponent("Confirm the report before it is published.")}`);
  }
  try {
    await publishCampaignReport({
      actor,
      campaignId,
      narrative: String(formData.get("narrative") ?? ""),
    });
  } catch (error) {
    unstable_rethrow(error);
    redirect(`${back}?error=${encodeURIComponent(message(error, "The report was not published."))}`);
  }
  redirect(`/campaigns/${campaignId}`);
}

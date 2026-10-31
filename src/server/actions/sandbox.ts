"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { toFormError, type FormState } from "@/server/form-state";
import { startSandboxPayment } from "@/server/sandbox-payments";
import { getActor } from "@/server/session";

/** Starts a mock sandbox attempt only. A Daraja callback cannot be posted from this action. */
export async function startSandboxPaymentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const nextPath = String(formData.get("next") ?? "/requests");
  const actor = await getActor();
  if (!actor) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const requestId = String(formData.get("requestId") ?? "").trim();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  try {
    const started = await startSandboxPayment({
      actor,
      requestId: requestId || null,
      campaignId: campaignId || null,
      shillings: Number(formData.get("amountShillings")),
      recognition: formData.get("recognition") === "public" ? "public" : "anonymous",
      publicName: String(formData.get("publicName") ?? ""),
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    });
    redirect(`/dashboard/donor/payments/${started.id}`);
  } catch (error) {
    unstable_rethrow(error);
    return toFormError(error);
  }
}

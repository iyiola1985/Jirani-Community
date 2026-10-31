"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { COUNTIES } from "@/data/counties";
import { isDatabaseConfigured } from "@/config/brand";
import { DomainError } from "@/domain/errors";
import { REQUEST_STATUSES, VERIFICATION_STATUSES, type RequestStatus } from "@/domain/types";
import { validateRequestForm } from "@/domain/validation";
import {
  addReviewNote,
  decideVerification,
  saveAssistance,
  transitionLive,
} from "@/server/assistance";
import { findDemoActor } from "@/server/accounts";
import { evidenceFromForm, gapFromForm } from "@/server/evidence-form";
import { type FormState } from "@/server/form-state";
import { allowRequest } from "@/server/rate-limit";
import { getActor } from "@/server/session";

async function signedIn() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

export async function saveAssistanceAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await signedIn();
  if (!actor.roles.includes("recipient")) {
    return { error: "Only a recipient account can submit a request.", notice: null, fieldErrors: {} };
  }
  if (findDemoActor(actor.id)) {
    return {
      error: "Demonstration accounts keep their sample requests in the labelled ledger. Register a recipient account to save an application in the database.",
      notice: null,
      fieldErrors: {},
    };
  }
  if (!isDatabaseConfigured()) {
    return { error: "The request database is not connected.", notice: null, fieldErrors: {} };
  }
  const intent = formData.get("intent") === "draft" ? "draft" : "submit";
  const parsed = validateRequestForm(
    {
      category: String(formData.get("category") ?? ""),
      title: String(formData.get("title") ?? ""),
      summary: String(formData.get("summary") ?? ""),
      county: String(formData.get("county") ?? ""),
      amountShillings: String(formData.get("amountShillings") ?? ""),
      publicAlias: String(formData.get("publicAlias") ?? ""),
      privateNotes: String(formData.get("privateNotes") ?? ""),
      locality: String(formData.get("locality") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      preferredAssistance: String(formData.get("preferredAssistance") ?? ""),
      urgent: checked(formData, "urgent"),
      acceptedPublication: checked(formData, "acceptedPublication"),
      accurate: checked(formData, "accurate"),
      understandsVerification: checked(formData, "understandsVerification"),
      understandsNoGuarantee: checked(formData, "understandsNoGuarantee"),
      understandsPrivate: checked(formData, "understandsPrivate"),
      acceptedPrivacy: checked(formData, "acceptedPrivacy"),
      mode: intent,
    },
    COUNTIES,
  );
  if (!parsed.ok) return { error: "Check the form and try again.", notice: null, fieldErrors: parsed.errors };
  const evidence = await evidenceFromForm(formData);
  if ("error" in evidence) return { error: evidence.error, notice: null, fieldErrors: {} };
  const evidenceGap = gapFromForm(formData);
  if (typeof evidenceGap !== "string") return { error: evidenceGap.error, notice: null, fieldErrors: {} };
  if (evidence.length > 0 && !allowRequest(`evidence:${actor.id}`, 12, 10 * 60 * 1000)) {
    return { error: "Too many uploads from this account. Wait a few minutes and try again.", notice: null, fieldErrors: {} };
  }
  try {
    const saved = await saveAssistance({
      actor,
      intent,
      clientToken: String(formData.get("clientToken") ?? ""),
      value: parsed.value,
      evidence,
      evidenceGap,
    });
    redirect(intent === "draft" ? `/dashboard/recipient/requests/${saved.id}` : "/dashboard/recipient");
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof DomainError ? error.message : "The request could not be saved.";
    return { error: message, notice: null, fieldErrors: {} };
  }
}

function requestStatus(value: string): RequestStatus | null {
  return REQUEST_STATUSES.find((item) => item === value) ?? null;
}

export async function decideRequestAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const requestId = String(formData.get("requestId") ?? "");
  const back = `/dashboard/admin/requests/${requestId}`;
  if (!actor.roles.includes("administrator")) redirect("/unauthorized");
  if (formData.get("confirmed") !== "on") {
    redirect(`${back}?error=${encodeURIComponent("Confirm the decision before it is recorded.")}`);
  }
  const to = requestStatus(String(formData.get("to") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim();
  const privateNote = String(formData.get("privateNote") ?? "").trim();
  if (!to) redirect(`${back}?error=${encodeURIComponent("Choose a decision the workflow allows.")}`);
  if (reason.length < 8) redirect(`${back}?error=${encodeURIComponent("Record a reason of at least 8 characters.")}`);
  try {
    await transitionLive({ actor, requestId, to, reason, privateNote });
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof DomainError ? error.message : "The decision was not recorded.";
    redirect(`${back}?error=${encodeURIComponent(message)}`);
  }
  redirect(back);
}

export async function decideVerificationAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const requestId = String(formData.get("requestId") ?? "");
  const profileId = String(formData.get("profileId") ?? "");
  const back = `/dashboard/admin/requests/${requestId}`;
  if (!actor.roles.includes("administrator")) redirect("/unauthorized");
  if (formData.get("confirmed") !== "on") {
    redirect(`${back}?error=${encodeURIComponent("Confirm the verification decision before it is recorded.")}`);
  }
  const to = VERIFICATION_STATUSES.find((item) => item === String(formData.get("to") ?? "")) ?? null;
  const reason = String(formData.get("reason") ?? "").trim();
  if (!to || to === "not_started" || to === "submitted") {
    redirect(`${back}?error=${encodeURIComponent("Choose a verification outcome.")}`);
  }
  if (reason.length < 8) redirect(`${back}?error=${encodeURIComponent("Record a reason of at least 8 characters.")}`);
  try {
    await decideVerification({ actor, profileId, to, reason });
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof DomainError ? error.message : "The verification was not recorded.";
    redirect(`${back}?error=${encodeURIComponent(message)}`);
  }
  redirect(back);
}

export async function addReviewNoteAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const requestId = String(formData.get("requestId") ?? "");
  const back = `/dashboard/admin/requests/${requestId}`;
  if (!actor.roles.includes("administrator")) redirect("/unauthorized");
  const body = String(formData.get("body") ?? "").trim();
  if (body.length < 8) redirect(`${back}?error=${encodeURIComponent("Write a private note of at least 8 characters.")}`);
  try {
    await addReviewNote(actor, requestId, body);
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof DomainError ? error.message : "The note was not saved.";
    redirect(`${back}?error=${encodeURIComponent(message)}`);
  }
  redirect(back);
}

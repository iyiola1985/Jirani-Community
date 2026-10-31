"use server";

import { redirect } from "next/navigation";

import { isDatabaseConfigured } from "@/config/brand";
import { accountClosePhraseMatches, replacementPasswordError } from "@/domain/account-close";
import { findDemoActor } from "@/server/accounts";
import {
  accountLifecycleMessage,
  closeStoredAccount,
  readSessionPasswordHash,
  replaceStoredPassword,
} from "@/server/account-lifecycle";
import type { FormState } from "@/server/form-state";
import { verifyPassword } from "@/server/passwords";
import { allowRequest } from "@/server/rate-limit";
import { clearSession, getActor } from "@/server/session";

async function requireDatabaseActor(): Promise<{ error: string } | { actor: NonNullable<Awaited<ReturnType<typeof getActor>>> }> {
  const actor = await getActor();
  if (!actor) redirect("/login?next=/dashboard/account");
  if (findDemoActor(actor.id)) {
    return { error: "A demonstration account is not stored in the database, so it cannot be changed or closed." };
  }
  if (!isDatabaseConfigured()) {
    return { error: "The account database is not connected." };
  }
  return { actor };
}

export async function changePasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const ready = await requireDatabaseActor();
  if ("error" in ready) return { error: ready.error, notice: null, fieldErrors: {} };
  if (!allowRequest(`password:${ready.actor.id}`, 5, 10 * 60 * 1000)) {
    return { error: "Too many password attempts. Wait a few minutes and try again.", notice: null, fieldErrors: {} };
  }
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("nextPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  const fieldError = replacementPasswordError(current, next, confirm);
  if (fieldError) return { error: fieldError, notice: null, fieldErrors: { nextPassword: fieldError } };
  try {
    const hash = await readSessionPasswordHash(ready.actor);
    if (!hash || !(await verifyPassword(current, hash))) {
      return { error: "The current password does not match this account.", notice: null, fieldErrors: {} };
    }
    await replaceStoredPassword(ready.actor, next);
  } catch (error) {
    return { error: accountLifecycleMessage(error, "password"), notice: null, fieldErrors: {} };
  }
  return { error: null, notice: "Password updated.", fieldErrors: {} };
}

export async function closeAccountAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const ready = await requireDatabaseActor();
  if ("error" in ready) return { error: ready.error, notice: null, fieldErrors: {} };
  if (!allowRequest(`close:${ready.actor.id}`, 5, 10 * 60 * 1000)) {
    return { error: "Too many attempts. Wait a few minutes and try again.", notice: null, fieldErrors: {} };
  }
  if (!accountClosePhraseMatches(String(formData.get("phrase") ?? ""))) {
    return {
      error: 'Type "delete my account" to confirm.',
      notice: null,
      fieldErrors: { phrase: 'Type "delete my account".' },
    };
  }
  const password = String(formData.get("password") ?? "");
  try {
    const hash = await readSessionPasswordHash(ready.actor);
    if (!hash || !(await verifyPassword(password, hash))) {
      return { error: "The password does not match this account.", notice: null, fieldErrors: {} };
    }
    await closeStoredAccount(ready.actor);
  } catch (error) {
    return { error: accountLifecycleMessage(error, "close"), notice: null, fieldErrors: {} };
  }
  await clearSession();
  redirect("/login?closed=1");
}

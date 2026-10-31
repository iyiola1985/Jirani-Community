"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isDatabaseConfigured, isDemoMode } from "@/config/brand";
import { COUNTIES } from "@/data/counties";
import { planPasswordReset, roleForNewAccount } from "@/domain/auth-access";
import { safeNextPath, validateRegistration } from "@/domain/validation";
import { authenticateDemo } from "@/server/accounts";
import { authenticateLocal, registerLocalAccount } from "@/server/directory";
import type { FormState } from "@/server/form-state";
import { siteOrigin } from "@/server/origin";
import { allowRequest } from "@/server/rate-limit";
import { clearSession, startSession } from "@/server/session";
import { createSupabaseServerClient } from "@/server/supabase";

export async function loginAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const nextPath = safeNextPath(String(formData.get("next") ?? ""));
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRequest(`login:${ip}:${email.toLowerCase()}`)) {
    return { error: "Too many sign-in attempts. Wait a few minutes and try again.", notice: null, fieldErrors: {} };
  }

  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (!error && data.user) redirect(nextPath);
  }

  if (isDatabaseConfigured()) {
    const local = await authenticateLocal(email, password);
    if (local.status === "ok") {
      await startSession(local.actor);
      redirect(nextPath);
    }
    if (local.status === "unavailable") {
      return { error: "The account database could not be reached. Try again shortly.", notice: null, fieldErrors: {} };
    }
  }

  if (isDemoMode()) {
    const actor = authenticateDemo(email, password);
    if (actor) {
      await startSession(actor);
      redirect(nextPath);
    }
  }

  return {
    error: "Those details do not match an account.",
    notice: null,
    fieldErrors: {},
  };
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  await clearSession();
  redirect("/");
}

export async function registerAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = validateRegistration(
    {
      displayName: String(formData.get("displayName") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? ""),
      acceptedTerms: formData.get("acceptedTerms") === "on",
      phone: String(formData.get("phone") ?? ""),
      county: String(formData.get("county") ?? ""),
    },
    COUNTIES,
  );
  if (!parsed.ok) return { error: "Check the form and try again.", notice: null, fieldErrors: parsed.errors };
  const role = roleForNewAccount(parsed.value.role);
  if (!role) {
    return {
      error: "That role cannot be chosen at registration.",
      notice: null,
      fieldErrors: { role: "Choose recipient, donor, or corporate partner." },
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase && isDatabaseConfigured()) {
    const saved = await registerLocalAccount({
      displayName: parsed.value.displayName,
      email: parsed.value.email,
      password: parsed.value.password,
      role,
      phone: parsed.value.phone,
      county: parsed.value.county,
    });
    if (saved.status === "duplicate") {
      return {
        error: "An account with that email already exists. Sign in instead.",
        notice: null,
        fieldErrors: { email: "An account with that email already exists." },
      };
    }
    if (saved.status !== "created") {
      return { error: "The account could not be saved. Try again shortly.", notice: null, fieldErrors: {} };
    }
    await startSession(saved.actor);
    redirect("/dashboard");
  }
  if (!supabase) {
    return {
      error:
        "The form is valid, but the account was not stored and no verification email was sent. Connect the database or Supabase Auth before creating accounts.",
      notice: null,
      fieldErrors: {},
    };
  }

  const origin = await siteOrigin();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.value.email,
    password: parsed.value.password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm`,
      data: {
        display_name: parsed.value.displayName,
        role,
        phone: parsed.value.phone ?? "",
        county: parsed.value.county ?? "",
      },
    },
  });
  if (error || !data.user) {
    return {
      error: "The account could not be created. If you already registered, sign in or reset the password.",
      notice: null,
      fieldErrors: {},
    };
  }
  if (data.session) redirect("/dashboard");
  return {
    error: null,
    notice: "Account created. Open the verification email before signing in. Nothing was stored in Jirani’s own password table.",
    fieldErrors: {},
  };
}

export async function forgotPasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const plan = planPasswordReset(String(formData.get("email") ?? ""), (await createSupabaseServerClient()) !== null);
  if (!plan.deliver) return { error: plan.message, notice: null, fieldErrors: { email: plan.message } };
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { error: "No reset email was sent. Supabase Auth is not configured.", notice: null, fieldErrors: {} };
  }
  const origin = await siteOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(plan.email, {
    redirectTo: `${origin}/auth/confirm?next=/auth/update-password`,
  });
  if (error) {
    return { error: "The reset email could not be sent. Check the Supabase email settings and try again.", notice: null, fieldErrors: {} };
  }
  return { error: null, notice: plan.message, fieldErrors: {} };
}

export async function updatePasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const fieldErrors: FormState["fieldErrors"] = {};
  if (password.length < 10) fieldErrors.password = "Use at least 10 characters.";
  if (password !== confirm) fieldErrors.confirm = "Enter the same password twice.";
  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Check the new password and try again.", notice: null, fieldErrors };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { error: "Supabase Auth is not configured, so the password was not changed.", notice: null, fieldErrors: {} };
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return {
      error: "Open the reset link from your email, then choose a new password.",
      notice: null,
      fieldErrors: {},
    };
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "The password could not be updated. Request a new reset link.", notice: null, fieldErrors: {} };
  }
  redirect("/dashboard");
}

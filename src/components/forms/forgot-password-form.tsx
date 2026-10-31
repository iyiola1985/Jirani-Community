"use client";

import { useActionState } from "react";

import { forgotPasswordAction } from "@/server/actions/auth";
import { emptyFormState } from "@/server/form-state";
import { inputClass, labelClass, primaryButton } from "@/components/ui/styles";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, emptyFormState);
  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="rounded-xl bg-mist px-3 py-2 text-sm text-ink">
          {state.notice}
        </p>
      ) : null}
      <label className={labelClass}>
        Email
        <input className={inputClass} name="email" type="email" autoComplete="email" required aria-invalid={Boolean(state.fieldErrors.email)} />
        {state.fieldErrors.email ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.email}</span> : null}
      </label>
      <button className={primaryButton} type="submit" disabled={pending}>
        {pending ? "Checking…" : "Send reset link"}
      </button>
    </form>
  );
}

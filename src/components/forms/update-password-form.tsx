"use client";

import { useActionState } from "react";

import { updatePasswordAction } from "@/server/actions/auth";
import { emptyFormState } from "@/server/form-state";
import { inputClass, labelClass, primaryButton } from "@/components/ui/styles";

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, emptyFormState);
  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">
          {state.error}
        </p>
      ) : null}
      <label className={labelClass}>
        New password
        <input className={inputClass} name="password" type="password" autoComplete="new-password" minLength={10} required aria-invalid={Boolean(state.fieldErrors.password)} />
        {state.fieldErrors.password ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.password}</span> : null}
      </label>
      <label className={labelClass}>
        Confirm password
        <input className={inputClass} name="confirm" type="password" autoComplete="new-password" minLength={10} required aria-invalid={Boolean(state.fieldErrors.confirm)} />
        {state.fieldErrors.confirm ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.confirm}</span> : null}
      </label>
      <button className={primaryButton} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}

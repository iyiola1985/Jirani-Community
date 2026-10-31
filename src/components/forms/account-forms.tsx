"use client";

import { useActionState } from "react";

import { closeAccountAction, changePasswordAction } from "@/server/actions/account";
import { emptyFormState } from "@/server/form-state";
import { clayButton, inputClass, labelClass, primaryButton } from "@/components/ui/styles";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, emptyFormState);
  return (
    <form action={action} className="space-y-4">
      {state.error ? <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">{state.error}</p> : null}
      {state.notice ? <p role="status" className="rounded-xl bg-mist px-3 py-2 text-sm text-ink">{state.notice}</p> : null}
      <label className={labelClass}>
        Current password
        <input className={inputClass} name="currentPassword" type="password" autoComplete="current-password" required />
      </label>
      <label className={labelClass}>
        New password
        <input className={inputClass} name="nextPassword" type="password" autoComplete="new-password" minLength={10} required />
      </label>
      <label className={labelClass}>
        Repeat the new password
        <input className={inputClass} name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required />
      </label>
      <button className={primaryButton} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}

export function CloseAccountForm() {
  const [state, action, pending] = useActionState(closeAccountAction, emptyFormState);
  return (
    <form action={action} className="space-y-4">
      {state.error ? <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">{state.error}</p> : null}
      <p className="text-sm leading-6 text-ink-soft">
        Closing removes sign-in, the email, phone, county, display name, private notes, and private files on your requests. Gift amounts and ledger rows stay. A public gift name is cleared. Text already published on a request stays on that page. The last administrator account cannot be closed.
      </p>
      <label className={labelClass}>
        Type “delete my account”
        <input className={inputClass} name="phrase" autoComplete="off" required />
        {state.fieldErrors.phrase ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.phrase}</span> : null}
      </label>
      <label className={labelClass}>
        Password
        <input className={inputClass} name="password" type="password" autoComplete="current-password" required />
      </label>
      <button className={clayButton} type="submit" disabled={pending}>
        {pending ? "Closing…" : "Close this account"}
      </button>
    </form>
  );
}

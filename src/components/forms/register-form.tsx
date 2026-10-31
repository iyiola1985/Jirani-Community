"use client";

import { useActionState } from "react";

import { registerAction } from "@/server/actions/auth";
import { emptyFormState } from "@/server/form-state";
import { COUNTIES } from "@/data/counties";
import { inputClass, labelClass, primaryButton } from "@/components/ui/styles";

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, emptyFormState);
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
        Public display name
        <input className={inputClass} name="displayName" autoComplete="nickname" required aria-invalid={Boolean(state.fieldErrors.displayName)} />
        {state.fieldErrors.displayName ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.displayName}</span> : null}
      </label>
      <label className={labelClass}>
        Email
        <input className={inputClass} name="email" type="email" autoComplete="email" required aria-invalid={Boolean(state.fieldErrors.email)} />
        {state.fieldErrors.email ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.email}</span> : null}
      </label>
      <label className={labelClass}>
        Password
        <input className={inputClass} name="password" type="password" autoComplete="new-password" minLength={10} required aria-invalid={Boolean(state.fieldErrors.password)} />
        {state.fieldErrors.password ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.password}</span> : null}
      </label>
      <label className={labelClass}>
        Mobile number
        <span className="mt-1 block font-normal text-ink-soft">Optional. A Kenyan number is checked, but no SMS is sent in this build.</span>
        <input className={inputClass} name="phone" type="tel" autoComplete="tel" inputMode="tel" aria-invalid={Boolean(state.fieldErrors.phone)} />
        {state.fieldErrors.phone ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.phone}</span> : null}
      </label>
      <label className={labelClass}>
        County
        <select className={inputClass} name="county" defaultValue="">
          <option value="">Prefer not to say</option>
          {COUNTIES.map((county) => (
            <option key={county} value={county}>{county}</option>
          ))}
        </select>
        {state.fieldErrors.county ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.county}</span> : null}
      </label>
      <fieldset>
        <legend className={labelClass}>I am here to</legend>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="radio" name="role" value="recipient" defaultChecked /> Request assistance
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="radio" name="role" value="donor" /> Give assistance
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="radio" name="role" value="corporate_partner" /> Support as an organisation
        </label>
        {state.fieldErrors.role ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.role}</span> : null}
      </fieldset>
      <label className="flex items-start gap-2 text-sm leading-6">
        <input className="mt-1" type="checkbox" name="acceptedTerms" />
        <span>I have read the draft terms and privacy notice.</span>
      </label>
      {state.fieldErrors.acceptedTerms ? <p className="text-sm text-clay">{state.fieldErrors.acceptedTerms}</p> : null}
      <button className={primaryButton} type="submit" disabled={pending}>
        {pending ? "Checking…" : "Create account"}
      </button>
    </form>
  );
}

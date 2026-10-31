"use client";

import { useActionState } from "react";

import { COUNTIES } from "@/data/counties";
import { categoryLabel } from "@/domain/labels";
import { CATEGORIES } from "@/domain/types";
import { submitRequestAction } from "@/server/actions/platform";
import { emptyFormState } from "@/server/form-state";
import { EvidencePicker } from "@/components/forms/evidence-picker";
import { inputClass, labelClass, primaryButton } from "@/components/ui/styles";

export function RequestForm() {
  const [state, action, pending] = useActionState(submitRequestAction, emptyFormState);
  return (
    <form action={action} className="space-y-5">
      {state.error ? <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">{state.error}</p> : null}
      <label className={labelClass}>
        Category
        <select className={inputClass} name="category" defaultValue="food">
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>{categoryLabel(category)}</option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Public title
        <input className={inputClass} name="title" required />
        {state.fieldErrors.title ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.title}</span> : null}
      </label>
      <label className={labelClass}>
        Public name
        <input className={inputClass} name="publicAlias" required />
        <span className="mt-1 block text-sm text-muted">This is the name visitors see. It can be different from your account name.</span>
        {state.fieldErrors.publicAlias ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.publicAlias}</span> : null}
      </label>
      <label className={labelClass}>
        County
        <select className={inputClass} name="county" defaultValue="Nairobi">
          {COUNTIES.map((county) => (
            <option key={county} value={county}>{county}</option>
          ))}
        </select>
        {state.fieldErrors.county ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.county}</span> : null}
      </label>
      <label className={labelClass}>
        Amount needed, in shillings
        <input className={inputClass} name="amountShillings" inputMode="numeric" min={100} step={1} required />
        {state.fieldErrors.amountShillings ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.amountShillings}</span> : null}
      </label>
      <label className={labelClass}>
        Public summary
        <textarea className={inputClass} name="summary" rows={5} required />
        <span className="mt-1 block text-sm text-muted">Describe the need and the county. Leave out phone numbers, exact addresses, identity numbers, medical details, and the names of children.</span>
        {state.fieldErrors.summary ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.summary}</span> : null}
      </label>
      <label className={labelClass}>
        Private note for the reviewer
        <textarea className={inputClass} name="privateNotes" rows={4} />
        <span className="mt-1 block text-sm text-muted">Donors do not see this. A file attached here is checked and then discarded. This demonstration does not keep the file.</span>
      </label>
      <EvidencePicker showGap notice="This demonstration checks the file and keeps only its name in the labelled ledger. It does not store the file, and it does not show it to donors. Video is optional." />
      <label className="flex items-start gap-2 text-sm leading-6">
        <input className="mt-1" type="checkbox" name="acceptedPublication" />
        <span>The public summary may be shown if an administrator approves the request.</span>
      </label>
      {state.fieldErrors.acceptedPublication ? <p className="text-sm text-clay">{state.fieldErrors.acceptedPublication}</p> : null}
      <button className={primaryButton} type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}

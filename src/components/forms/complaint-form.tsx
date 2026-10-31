"use client";

import { useActionState } from "react";

import { complaintAction } from "@/server/actions/platform";
import { emptyFormState } from "@/server/form-state";
import { inputClass, labelClass, primaryButton } from "@/components/ui/styles";

export function ComplaintForm() {
  const [state, action, pending] = useActionState(complaintAction, emptyFormState);
  return (
    <form action={action} className="space-y-4">
      {state.error ? <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">{state.error}</p> : null}
      {state.notice ? <p role="status" className="rounded-xl bg-mist px-3 py-2 text-sm text-lagoon-deep">{state.notice}</p> : null}
      <label className={labelClass}>
        This concerns
        <select className={inputClass} name="subjectType" defaultValue="platform">
          <option value="platform">The platform</option>
          <option value="request">An assistance request</option>
          <option value="campaign">A campaign</option>
          <option value="contribution">A contribution</option>
        </select>
      </label>
      <label className={labelClass}>
        What should a reviewer know?
        <textarea className={inputClass} name="body" rows={5} required />
      </label>
      <button className={primaryButton} type="submit" disabled={pending}>
        {pending ? "Sending…" : "Submit to the reviewer"}
      </button>
    </form>
  );
}

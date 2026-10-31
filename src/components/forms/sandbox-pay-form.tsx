"use client";

import { useActionState, useState } from "react";

import { startSandboxPaymentAction } from "@/server/actions/sandbox";
import { emptyFormState } from "@/server/form-state";
import { inputClass, labelClass, primaryButton, quietButton } from "@/components/ui/styles";

export function SandboxPayForm(props: {
  requestId?: string;
  campaignId?: string;
  nextPath: string;
  idempotencyKey: string;
  signedIn: boolean;
  donor: boolean;
}) {
  const [state, action, pending] = useActionState(startSandboxPaymentAction, emptyFormState);
  const [amount, setAmount] = useState("500");
  if (!props.signedIn) {
    return <p className="mt-3 text-sm">Sign in with a donor account before starting a sandbox payment.</p>;
  }
  if (!props.donor) {
    return <p className="mt-3 text-sm">A donor account starts sandbox payments.</p>;
  }
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="requestId" value={props.requestId ?? ""} />
      <input type="hidden" name="campaignId" value={props.campaignId ?? ""} />
      <input type="hidden" name="next" value={props.nextPath} />
      <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
      {state.error ? <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">{state.error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {["100", "500", "1000"].map((preset) => (
          <button key={preset} className={amount === preset ? primaryButton : quietButton} type="button" onClick={() => setAmount(preset)}>
            KSh {Number(preset).toLocaleString("en-KE")}
          </button>
        ))}
      </div>
      <label className={labelClass}>
        Amount, in shillings
        <input className={inputClass} name="amountShillings" inputMode="numeric" min={100} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} required />
      </label>
      <label className="flex gap-2 text-sm"><input type="radio" name="recognition" value="anonymous" defaultChecked /> Show as Anonymous</label>
      <label className="flex gap-2 text-sm"><input type="radio" name="recognition" value="public" /> Show a public name</label>
      <label className={labelClass}>
        Public name, if you chose one
        <input className={inputClass} name="publicName" />
      </label>
      <button className={primaryButton} type="submit" disabled={pending}>
        {pending ? "Starting…" : "Start sandbox payment"}
      </button>
    </form>
  );
}

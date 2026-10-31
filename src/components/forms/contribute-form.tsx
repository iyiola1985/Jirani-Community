"use client";

import { useActionState, useState } from "react";

import { startContributionAction } from "@/server/actions/platform";
import { emptyFormState } from "@/server/form-state";
import { inputClass, labelClass, primaryButton, quietButton } from "@/components/ui/styles";

export function ContributeForm(props: {
  requestId?: string;
  campaignId?: string;
  nextPath: string;
  idempotencyKey: string;
  signedIn: boolean;
  donor: boolean;
}) {
  const [state, action, pending] = useActionState(startContributionAction, emptyFormState);
  const [amount, setAmount] = useState("500");
  if (!props.signedIn) {
    return (
      <p className="text-sm leading-6">
        <a className="font-semibold underline" href={`/login?next=${encodeURIComponent(props.nextPath)}`}>Sign in</a> with a donor account to record a simulated gift.
      </p>
    );
  }
  if (!props.donor) {
    return <p className="text-sm leading-6">This account can request help. A donor account records gifts.</p>;
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="requestId" value={props.requestId ?? ""} />
      <input type="hidden" name="campaignId" value={props.campaignId ?? ""} />
      <input type="hidden" name="next" value={props.nextPath} />
      <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
      {state.error ? <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">{state.error}</p> : null}
      {state.notice ? <p className="rounded-xl bg-sand px-3 py-2 text-sm leading-6">{state.notice}</p> : null}
      <p className="text-sm leading-6 text-ink-soft">Demonstration amounts. No M-Pesa prompt is sent, and confirming a simulation does not collect money or pay the applicant.</p>
      <div className="flex flex-wrap gap-2">
        {["100", "500", "1000"].map((preset) => (
          <button key={preset} className={amount === preset ? primaryButton : quietButton} type="button" onClick={() => setAmount(preset)}>
            KSh {Number(preset).toLocaleString("en-KE")}
          </button>
        ))}
      </div>
      <label className={labelClass}>
        Gift, in shillings
        <input className={inputClass} name="amountShillings" inputMode="numeric" min={100} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} required />
      </label>
      <fieldset>
        <legend className={labelClass}>Public recognition</legend>
        <label className="mt-2 flex gap-2 text-sm"><input type="radio" name="recognition" value="anonymous" defaultChecked /> Show as Anonymous</label>
        <label className="mt-2 flex gap-2 text-sm"><input type="radio" name="recognition" value="public" /> Show a public name</label>
      </fieldset>
      <label className={labelClass}>
        Public name, if you chose one
        <input className={inputClass} name="publicName" />
      </label>
      <p className="rounded-2xl bg-sand px-4 py-3 text-sm leading-6 text-ink">
        Platform fee: Ksh 0. Provider fee: Ksh 0. This is a simulated checkout, not M-Pesa. The next page asks the simulator to report a result. Opening that page does not mark the gift as successful.
      </p>
      <button className={primaryButton} type="submit" disabled={pending}>
        {pending ? "Recording…" : "Continue to simulated checkout"}
      </button>
    </form>
  );
}

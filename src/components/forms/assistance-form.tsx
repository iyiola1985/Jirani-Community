"use client";

import { useActionState, useState } from "react";

import { COUNTIES } from "@/data/counties";
import { categoryLabel } from "@/domain/labels";
import { CATEGORIES, type Category } from "@/domain/types";
import { saveAssistanceAction } from "@/server/actions/assistance";
import { emptyFormState } from "@/server/form-state";
import { EvidencePicker } from "@/components/forms/evidence-picker";
import { inputClass, labelClass, primaryButton, quietButton } from "@/components/ui/styles";

const STEPS = ["Type of assistance", "Request details", "Supporting evidence", "Review and consent"] as const;

export function AssistanceForm(props: {
  clientToken: string;
  initial?: {
    category: Category;
    preferredAssistance: Category;
    title: string;
    summary: string;
    county: string;
    locality: string;
    amountShillings: string;
    publicAlias: string;
    reason: string;
    privateNotes: string;
    urgent: boolean;
  };
}) {
  const [state, action, pending] = useActionState(saveAssistanceAction, emptyFormState);
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<Category>(props.initial?.category ?? "food");
  const [preferred, setPreferred] = useState<Category>(props.initial?.preferredAssistance ?? "food");
  const [title, setTitle] = useState(props.initial?.title ?? "");
  const [summary, setSummary] = useState(props.initial?.summary ?? "");
  const [county, setCounty] = useState(props.initial?.county ?? "Nairobi");
  const [locality, setLocality] = useState(props.initial?.locality ?? "");
  const [amount, setAmount] = useState(props.initial?.amountShillings ?? "");
  const [alias, setAlias] = useState(props.initial?.publicAlias ?? "");
  const [reason, setReason] = useState(props.initial?.reason ?? "");
  const [notes, setNotes] = useState(props.initial?.privateNotes ?? "");
  const [urgent, setUrgent] = useState(props.initial?.urgent ?? false);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="clientToken" value={props.clientToken} />
      <ol className="grid gap-2 text-sm sm:grid-cols-4">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? "font-semibold text-lagoon" : "text-muted"}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      {state.error ? <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">{state.error}</p> : null}
      {Object.keys(state.fieldErrors).length > 0 ? (
        <ul className="space-y-1 text-sm text-clay">
          {Object.entries(state.fieldErrors).map(([field, message]) => <li key={field}>{message}</li>)}
        </ul>
      ) : null}

      <fieldset className={step === 0 ? "space-y-3" : "hidden"}>
        <legend className={labelClass}>What kind of help is needed?</legend>
        {CATEGORIES.map((item) => (
          <label key={item} className="flex items-start gap-3 rounded-2xl border border-line px-3 py-3 text-sm">
            <input type="radio" name="category" value={item} checked={category === item} onChange={() => setCategory(item)} />
            <span>{categoryLabel(item)}</span>
          </label>
        ))}
        {state.fieldErrors.category ? <p className="text-sm text-clay">{state.fieldErrors.category}</p> : null}
      </fieldset>

      <div className={step === 1 ? "space-y-4" : "hidden"}>
        <label className={labelClass}>
          Request title
          <input className={inputClass} name="title" value={title} onChange={(event) => setTitle(event.target.value)} />
          {state.fieldErrors.title ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.title}</span> : null}
        </label>
        <label className={labelClass}>
          Public name
          <input className={inputClass} name="publicAlias" value={alias} onChange={(event) => setAlias(event.target.value)} />
          <span className="mt-1 block text-sm text-muted">This is the name visitors see. It can be different from your account name.</span>
          {state.fieldErrors.publicAlias ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.publicAlias}</span> : null}
        </label>
        <label className={labelClass}>
          Description visitors may see
          <textarea className={inputClass} name="summary" rows={5} value={summary} onChange={(event) => setSummary(event.target.value)} />
          <span className="mt-1 block text-sm text-muted">Describe the need and the county. Leave out phone numbers, exact addresses, identity numbers, medical details, and the names of children.</span>
          {state.fieldErrors.summary ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.summary}</span> : null}
        </label>
        <label className={labelClass}>
          Amount needed, in shillings
          <input className={inputClass} name="amountShillings" inputMode="numeric" min={100} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} />
          {state.fieldErrors.amountShillings ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.amountShillings}</span> : null}
        </label>
        <label className={labelClass}>
          County
          <select className={inputClass} name="county" value={county} onChange={(event) => setCounty(event.target.value)}>
            {COUNTIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          {state.fieldErrors.county ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.county}</span> : null}
        </label>
        <label className={labelClass}>
          General area
          <input className={inputClass} name="locality" value={locality} onChange={(event) => setLocality(event.target.value)} />
          <span className="mt-1 block text-sm text-muted">A town or ward is enough. Do not enter a plot or house number.</span>
          {state.fieldErrors.locality ? <span className="mt-1 block text-sm text-clay">{state.fieldErrors.locality}</span> : null}
        </label>
        <label className={labelClass}>
          Preferred assistance
          <select className={inputClass} name="preferredAssistance" value={preferred} onChange={(event) => setPreferred(event.target.value as Category)}>
            {CATEGORIES.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Why this help is needed
          <textarea className={inputClass} name="reason" rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
          <span className="mt-1 block text-sm text-muted">Reviewers see this. It is not placed on the public page.</span>
        </label>
        <label className="flex items-start gap-2 text-sm leading-6">
          <input type="checkbox" name="urgent" checked={urgent} onChange={(event) => setUrgent(event.target.checked)} />
          <span>This need is urgent.</span>
        </label>
        <label className={labelClass}>
          Private note for the reviewer
          <textarea className={inputClass} name="privateNotes" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </div>

      <div className={step === 2 ? "space-y-4" : "hidden"}>
        <EvidencePicker showGap />
      </div>

      <div className={step === 3 ? "space-y-4" : "hidden"}>
        <div className="rounded-2xl bg-sand px-4 py-4 text-sm leading-6">
          <p className="font-semibold">{title || "Untitled request"}</p>
          <p className="mt-1">{categoryLabel(category)} · {county}{locality ? ` · ${locality}` : ""}{urgent ? " · Urgent" : ""}</p>
          <p className="mt-1">KSh {amount || "0"} · Public name {alias || "not set"}</p>
          <p className="mt-3">{summary}</p>
        </div>
        <p className="text-sm leading-6 text-ink-soft">Submitting an application does not guarantee funding, and it does not publish the request. An administrator reviews it first.</p>
        {[
          ["accurate", "The information is accurate to the best of my knowledge."],
          ["understandsVerification", "I understand that verification may be required."],
          ["understandsNoGuarantee", "I understand that submitting an application does not guarantee funding."],
          ["understandsPrivate", "My private supporting documents will not automatically become public."],
          ["acceptedPrivacy", "Any public request information will be handled according to the privacy notice."],
          ["acceptedPublication", "The public summary may be shown if an administrator approves the request."],
        ].map(([name, label]) => (
          <label key={name} className="flex items-start gap-2 text-sm leading-6">
            <input className="mt-1" type="checkbox" name={name} />
            <span>{label}{state.fieldErrors[name] ? <span className="mt-1 block text-clay">{state.fieldErrors[name]}</span> : null}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        {step > 0 ? <button className={quietButton} type="button" onClick={() => setStep((current) => current - 1)}>Back</button> : null}
        {step < 3 ? <button className={primaryButton} type="button" onClick={() => setStep((current) => current + 1)}>Continue</button> : null}
        <button className={quietButton} type="submit" name="intent" value="draft" disabled={pending}>
          {pending ? "Saving…" : "Save draft"}
        </button>
        {step === 3 ? (
          <button className={primaryButton} type="submit" name="intent" value="submit" disabled={pending}>
            {pending ? "Submitting…" : "Submit for review"}
          </button>
        ) : null}
      </div>
    </form>
  );
}

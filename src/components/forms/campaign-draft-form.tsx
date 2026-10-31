"use client";

import { useActionState } from "react";

import { COUNTIES } from "@/data/counties";
import { CAMPAIGN_CATEGORIES, type CampaignCategory } from "@/domain/types";
import { categoryLabel } from "@/domain/labels";
import { saveCampaignAction } from "@/server/actions/campaigns";
import { emptyFormState } from "@/server/form-state";
import { inputClass, labelClass, primaryButton } from "@/components/ui/styles";

export function CampaignDraftForm(props: {
  campaignId?: string;
  defaults?: {
    title: string;
    slug: string;
    category: CampaignCategory;
    objective: string;
    amountShillings: string;
    startsAt: string;
    endsAt: string;
    county: string;
    beneficiaryGroup: string;
    eligibilityCriteria: string;
    selectionRules: string;
    feeDisclosure: string;
    refundPolicy: string;
    surplusPolicy: string;
    cancellationAllowed: boolean;
    imagePath: string | null;
  };
}) {
  const [state, action, pending] = useActionState(saveCampaignAction, emptyFormState);
  const values = props.defaults;
  return (
    <form action={action} className="space-y-4">
      {props.campaignId ? <input type="hidden" name="campaignId" value={props.campaignId} /> : null}
      {values?.imagePath ? <input type="hidden" name="existingImage" value={values.imagePath} /> : null}
      {state.error ? <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">{state.error}</p> : null}
      <label className={labelClass}>
        Title
        <input className={inputClass} name="title" required minLength={8} maxLength={120} defaultValue={values?.title} />
      </label>
      <label className={labelClass}>
        Public link
        <input className={inputClass} name="slug" required minLength={3} maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={values?.slug} placeholder="school-fees-kisumu" />
      </label>
      <label className={labelClass}>
        Category
        <select className={inputClass} name="category" required defaultValue={values?.category ?? ""}>
          <option value="">Choose one</option>
          {CAMPAIGN_CATEGORIES.map((category) => (
            <option key={category} value={category}>{categoryLabel(category)}</option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Objective
        <textarea className={inputClass} name="objective" required minLength={40} maxLength={2000} rows={4} defaultValue={values?.objective} />
      </label>
      <label className={labelClass}>
        Target, in shillings
        <input className={inputClass} name="amountShillings" inputMode="numeric" min={100} step={1} required defaultValue={values?.amountShillings ?? "10000"} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Opens, Nairobi time
          <input className={inputClass} type="datetime-local" name="startsAt" required defaultValue={values?.startsAt} />
        </label>
        <label className={labelClass}>
          Closes, Nairobi time
          <input className={inputClass} type="datetime-local" name="endsAt" required defaultValue={values?.endsAt} />
        </label>
      </div>
      <label className={labelClass}>
        County or area
        <select className={inputClass} name="county" required defaultValue={values?.county ?? ""}>
          <option value="">Choose one</option>
          <option value="Kenya">Kenya</option>
          {COUNTIES.map((county) => (
            <option key={county} value={county}>{county}</option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Intended beneficiary group
        <input className={inputClass} name="beneficiaryGroup" required minLength={8} maxLength={200} defaultValue={values?.beneficiaryGroup} />
      </label>
      <label className={labelClass}>
        Eligibility criteria
        <textarea className={inputClass} name="eligibilityCriteria" required minLength={40} maxLength={2000} rows={4} defaultValue={values?.eligibilityCriteria} />
      </label>
      <label className={labelClass}>
        How beneficiaries are selected
        <textarea className={inputClass} name="selectionRules" required minLength={40} maxLength={2000} rows={4} defaultValue={values?.selectionRules} />
      </label>
      <label className={labelClass}>
        Platform fee policy
        <textarea className={inputClass} name="feeDisclosure" required minLength={20} maxLength={2000} rows={3} defaultValue={values?.feeDisclosure} />
      </label>
      <label className={labelClass}>
        Refund policy
        <textarea className={inputClass} name="refundPolicy" required minLength={20} maxLength={2000} rows={3} defaultValue={values?.refundPolicy} />
      </label>
      <label className={labelClass}>
        Surplus policy
        <textarea className={inputClass} name="surplusPolicy" required minLength={20} maxLength={2000} rows={3} defaultValue={values?.surplusPolicy} />
      </label>
      <label className="flex items-start gap-2 text-sm leading-6">
        <input className="mt-1" type="checkbox" name="cancellationAllowed" defaultChecked={values?.cancellationAllowed} />
        <span>The published policy allows this campaign to be cancelled after it is scheduled or active. Cancellation does not delete gifts.</span>
      </label>
      <p className="text-sm leading-6 text-ink-soft">
        Private evidence is added from the campaign page after this draft is saved. It is not the public image, and it is not shown on the public campaign page. Video is optional.
      </p>
      <label className={labelClass}>
        Public image, optional JPEG, PNG, or WebP
        <input className={inputClass} type="file" name="image" accept="image/jpeg,image/png,image/webp" />
      </label>
      <button className={primaryButton} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save draft"}
      </button>
    </form>
  );
}

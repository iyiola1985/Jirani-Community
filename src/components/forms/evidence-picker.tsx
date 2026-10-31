"use client";

import { useActionState, useRef, useState } from "react";

import {
  EVIDENCE_ACCEPT,
  EVIDENCE_APPLICANT_NOTICE,
  EVIDENCE_CATEGORIES,
  evidenceCategoryLabel,
  type EvidenceCategory,
} from "@/domain/evidence";
import { addRequestEvidenceAction, addCampaignEvidenceAction } from "@/server/actions/evidence";
import { emptyFormState } from "@/server/form-state";
import { inputClass, labelClass, primaryButton, quietButton } from "@/components/ui/styles";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function EvidencePicker(props: { showGap?: boolean; notice?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [categories, setCategories] = useState<EvidenceCategory[]>([]);
  const [descriptions, setDescriptions] = useState<string[]>([]);

  function sync(next: File[], nextCategories: EvidenceCategory[], nextDescriptions: string[]) {
    const transfer = new DataTransfer();
    for (const file of next) transfer.items.add(file);
    if (inputRef.current) inputRef.current.files = transfer.files;
    setFiles(next);
    setCategories(nextCategories);
    setDescriptions(nextDescriptions);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-ink-soft">{props.notice ?? EVIDENCE_APPLICANT_NOTICE}</p>
      <label className={labelClass}>
        Files
        <input
          ref={inputRef}
          className={inputClass}
          name="evidence"
          type="file"
          multiple
          accept={EVIDENCE_ACCEPT}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            sync(selected, selected.map(() => "other_supporting"), selected.map(() => ""));
          }}
        />
      </label>
      <p className="text-sm text-muted">
        {files.length === 0
          ? "No file selected. The form reports saved or failed after you submit. It does not show a percentage."
          : "Selected files. Remove one before you submit if you chose the wrong document. Upload progress is saved or failed, not a percentage."}
      </p>
      <ul className="space-y-3">
        {files.map((file, index) => (
          <li key={`${file.name}-${file.size}-${index}`} className="rounded-2xl border border-line p-3 text-sm">
            <p className="break-all font-semibold">{file.name}</p>
            <p className="text-muted">{file.type || "type checked on the server"} · {formatBytes(file.size)}</p>
            <label className={`${labelClass} mt-3`}>
              Category
              <select
                className={inputClass}
                name="evidenceCategory"
                value={categories[index] ?? "other_supporting"}
                onChange={(event) => {
                  const next = [...categories];
                  next[index] = event.target.value as EvidenceCategory;
                  setCategories(next);
                }}
              >
                {EVIDENCE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{evidenceCategoryLabel(category)}</option>
                ))}
              </select>
            </label>
            <label className={`${labelClass} mt-3`}>
              Short description, optional
              <input
                className={inputClass}
                name="evidenceDescription"
                maxLength={240}
                value={descriptions[index] ?? ""}
                placeholder="What this file shows"
                onChange={(event) => {
                  const next = [...descriptions];
                  next[index] = event.target.value;
                  setDescriptions(next);
                }}
              />
            </label>
            <button
              className={`${quietButton} mt-3`}
              type="button"
              onClick={() => sync(
                files.filter((_, item) => item !== index),
                categories.filter((_, item) => item !== index),
                descriptions.filter((_, item) => item !== index),
              )}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {props.showGap ? (
        <label className={labelClass}>
          If a document is missing, say which one and why
          <textarea className={inputClass} name="evidenceGap" rows={3} maxLength={500} />
        </label>
      ) : null}
    </div>
  );
}

export function RequestEvidenceForm(props: { requestId: string }) {
  const [state, action, pending] = useActionState(addRequestEvidenceAction, emptyFormState);
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="requestId" value={props.requestId} />
      {state.error ? <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">{state.error}</p> : null}
      <EvidencePicker showGap />
      <button className={primaryButton} type="submit" disabled={pending}>{pending ? "Uploading…" : "Add documents"}</button>
    </form>
  );
}

export function CampaignEvidenceForm(props: { campaignId: string }) {
  const [state, action, pending] = useActionState(addCampaignEvidenceAction, emptyFormState);
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="campaignId" value={props.campaignId} />
      {state.error ? <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">{state.error}</p> : null}
      <EvidencePicker notice="These files stay off the public campaign page. Another administrator reviews a file you upload. Uploading does not approve the campaign, and video is optional. No malware scanner is configured." />
      <button className={primaryButton} type="submit" disabled={pending}>{pending ? "Uploading…" : "Add private documents"}</button>
    </form>
  );
}

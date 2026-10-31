"use client";

import type { ReactNode } from "react";

import { quietButton } from "@/components/ui/styles";

export function DecisionForm(props: {
  action: (formData: FormData) => void | Promise<void>;
  confirm: string;
  children: ReactNode;
  label: string;
  acknowledgement?: string;
}) {
  return (
    <form
      action={props.action}
      className="space-y-3 rounded-2xl border border-line p-4"
      onSubmit={(event) => {
        if (!window.confirm(props.confirm)) event.preventDefault();
      }}
    >
      {props.children}
      <label className="flex items-start gap-2 text-sm leading-6">
        <input className="mt-1" type="checkbox" name="confirmed" required />
        <span>{props.acknowledgement ?? "I have checked the request and I want this decision recorded."}</span>
      </label>
      <button className={quietButton} type="submit">{props.label}</button>
    </form>
  );
}

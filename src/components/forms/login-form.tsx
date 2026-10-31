"use client";

import Link from "next/link";
import { useActionState } from "react";

import { loginAction } from "@/server/actions/auth";
import { emptyFormState } from "@/server/form-state";
import { inputClass, labelClass, primaryButton } from "@/components/ui/styles";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, action, pending] = useActionState(loginAction, emptyFormState);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={nextPath} />
      {state.error ? (
        <p role="alert" className="rounded-xl bg-[#f8e8e4] px-3 py-2 text-sm text-clay">
          {state.error}
        </p>
      ) : null}
      <label className={labelClass}>
        Email
        <input className={inputClass} name="email" type="email" autoComplete="username" required />
      </label>
      <label className={labelClass}>
        Password
        <input className={inputClass} name="password" type="password" autoComplete="current-password" required />
      </label>
      <button className={primaryButton} type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-sm">
        <Link className="font-semibold underline" href="/forgot-password">Forgot password</Link>
      </p>
    </form>
  );
}

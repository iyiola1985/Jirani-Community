import Link from "next/link";

import { ForgotPasswordForm } from "@/components/forms/forgot-password-form";
import { panelClass } from "@/components/ui/styles";
import { isSupabaseConfigured } from "@/config/supabase";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  const configured = isSupabaseConfigured();
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <section className={panelClass}>
        <h1 className="font-serif text-4xl">Reset password</h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          {configured
            ? "If the address has an account, Supabase sends the reset email. Jirani does not store the password."
            : "Supabase Auth is not configured in this environment. Submitting the form will not send an email."}
        </p>
        <div className="mt-6">
          <ForgotPasswordForm />
        </div>
        <p className="mt-4 text-sm">
          <Link className="font-semibold underline" href="/login">Back to sign in</Link>
        </p>
      </section>
    </div>
  );
}

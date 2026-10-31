import Link from "next/link";

import { RegisterForm } from "@/components/forms/register-form";
import { panelClass } from "@/components/ui/styles";
import { isDatabaseConfigured } from "@/config/brand";
import { isSupabaseConfigured } from "@/config/supabase";

export const metadata = { title: "Register" };

export default function RegisterPage() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
      <section>
        <h1 className="font-serif text-4xl">Create an account</h1>
        <p className="mt-4 leading-7 text-ink-soft">
          Choose recipient, donor, or corporate partner. One account can hold more than one of those later. Administrator access is granted from the database by an existing administrator, never from this form.
          {isSupabaseConfigured()
            ? " A verification email is sent by Supabase before the account can be used."
            : isDatabaseConfigured()
              ? " The account is saved in the project database. The password is stored only as a hash, and no verification email is sent from this environment."
              : " Nothing is saved until the database or Supabase Auth is connected."}
        </p>
        <p className="mt-4 text-sm">
          Already exploring? <Link className="font-semibold underline" href="/login">Sign in</Link>
        </p>
      </section>
      <section className={panelClass}>
        <RegisterForm />
      </section>
    </div>
  );
}

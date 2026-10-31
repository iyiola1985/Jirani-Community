import Link from "next/link";

import { UpdatePasswordForm } from "@/components/forms/update-password-form";
import { panelClass } from "@/components/ui/styles";

export const metadata = { title: "Choose a new password" };

export default function UpdatePasswordPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <section className={panelClass}>
        <h1 className="font-serif text-4xl">Choose a new password</h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          Use the link from the reset email so this page has a recovery session. The new password is saved by Supabase Auth.
        </p>
        <div className="mt-6">
          <UpdatePasswordForm />
        </div>
        <p className="mt-4 text-sm">
          <Link className="font-semibold underline" href="/forgot-password">Request another link</Link>
        </p>
      </section>
    </div>
  );
}

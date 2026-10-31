import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ChangePasswordForm, CloseAccountForm } from "@/components/forms/account-forms";
import { panelClass } from "@/components/ui/styles";
import { findDemoActor } from "@/server/accounts";
import { getActor } from "@/server/session";

export const metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <Suspense fallback={<p className="px-6 py-16">Opening your account…</p>}>
      <AccountScreen />
    </Suspense>
  );
}

async function AccountScreen() {
  await connection();
  const actor = await getActor();
  if (!actor) redirect("/login?next=/dashboard/account");
  const demonstration = findDemoActor(actor.id) !== null;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Account</p>
      <h1 className="mt-3 font-serif text-4xl">{actor.displayName}</h1>
      <p className="mt-4 leading-7 text-ink-soft">
        <Link className="font-semibold text-lagoon" href="/dashboard">Back to the dashboard</Link>
      </p>
      {demonstration ? (
        <section className={`${panelClass} mt-8`}>
          <h2 className="font-serif text-2xl">Demonstration sign-in</h2>
          <p className="mt-3 leading-7 text-ink-soft">
            This sign-in is labelled demonstration data. It is not a database account, so the password cannot be changed here and there is nothing to close.
          </p>
        </section>
      ) : (
        <>
          <section className={`${panelClass} mt-8`}>
            <h2 className="font-serif text-2xl">Password</h2>
            <p className="mt-3 leading-7 text-ink-soft">
              The new password replaces the stored hash. No reset email is sent from this database.
            </p>
            <div className="mt-6">
              <ChangePasswordForm />
            </div>
          </section>
          <section className={`${panelClass} mt-8`}>
            <h2 className="font-serif text-2xl">Close account</h2>
            <div className="mt-6">
              <CloseAccountForm />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

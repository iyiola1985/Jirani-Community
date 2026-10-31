import Link from "next/link";
import { Suspense } from "react";

import { LoginForm } from "@/components/forms/login-form";
import { panelClass } from "@/components/ui/styles";
import { isDatabaseConfigured, isDemoMode } from "@/config/brand";
import { isSupabaseConfigured } from "@/config/supabase";
import { safeNextPath } from "@/domain/validation";
import { DEMO_LOGIN_HINTS } from "@/server/accounts";

export const metadata = { title: "Sign in" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; closed?: string }>;
}) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading sign in…</p>}>
      <LoginScreen searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginScreen({ searchParams }: { searchParams: Promise<{ next?: string; closed?: string }> }) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);
  const closed = params.closed === "1";
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2">
      <section className={panelClass}>
        <h1 className="font-serif text-4xl">Sign in</h1>
        {closed ? (
          <p role="status" className="mt-3 rounded-xl bg-mist px-3 py-2 text-sm leading-6 text-ink">
            The account is closed. Sign-in for that email has been removed. Gift records stay, without the public name. The same email can be used to register again.
          </p>
        ) : null}
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          {isSupabaseConfigured()
            ? "Sign in with the email and password on your account. A session stays in a secure cookie until it expires or you sign out."
            : isDatabaseConfigured()
              ? "Sign in with the email and password you registered. The session stays in a secure cookie, and your dashboard follows the role stored for this account."
              : isDemoMode()
                ? "Supabase Auth is not configured, so this screen signs in to the labelled local demonstration accounts only."
                : "Sign-in needs the account database or Supabase Auth. Demonstration accounts are not enabled."}
        </p>
        <div className="mt-6">
          <LoginForm nextPath={nextPath} />
        </div>
        <p className="mt-4 text-sm">
          Need an account? <Link className="font-semibold underline" href="/register">Register</Link>
        </p>
      </section>
      {isDemoMode() ? (
        <section className={panelClass}>
          <h2 className="font-serif text-2xl">Local demonstration accounts</h2>
          <p className="mt-2 text-sm leading-6 text-ink-soft">These are not real people. This list is shown only when demonstration mode is turned on for local development. These passwords do not work in production.</p>
          <dl className="mt-4 space-y-4 text-sm">
            {DEMO_LOGIN_HINTS.map((account) => (
              <div key={account.email}>
                <dt className="font-semibold">{account.role}</dt>
                <dd className="text-ink-soft">{account.email}</dd>
                <dd className="text-ink-soft">Password: {account.password}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

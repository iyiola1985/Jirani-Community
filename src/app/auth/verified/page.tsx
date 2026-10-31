import Link from "next/link";

import { panelClass, primaryButton } from "@/components/ui/styles";

export const metadata = { title: "Email confirmed" };

export default function VerifiedPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <section className={panelClass}>
        <h1 className="font-serif text-4xl">Email confirmed</h1>
        <p className="mt-4 leading-7 text-ink-soft">
          The confirmation link was accepted. Sign in if you are not taken straight to your dashboard.
        </p>
        <div className="mt-6">
          <Link className={primaryButton} href="/dashboard">Continue</Link>
        </div>
      </section>
    </div>
  );
}

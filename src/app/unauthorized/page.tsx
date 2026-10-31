import Link from "next/link";

import { panelClass, primaryButton } from "@/components/ui/styles";

export const metadata = { title: "Not available" };

export default function UnauthorizedPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <section className={panelClass}>
        <h1 className="font-serif text-4xl">This area is not open to this account</h1>
        <p className="mt-4 leading-7 text-ink-soft">
          The signed-in roles do not include access here. A corporate account is not an administrator, and nobody can grant themselves that role from the browser.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link className={primaryButton} href="/dashboard">Your workspaces</Link>
          <Link className={primaryButton} href="/">Home</Link>
        </div>
      </section>
    </div>
  );
}

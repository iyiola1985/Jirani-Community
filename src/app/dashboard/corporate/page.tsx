import { connection } from "next/server";
import { Suspense } from "react";

import { panelClass } from "@/components/ui/styles";
import { guardDashboard } from "@/server/guard";

export const metadata = { title: "Organisation" };

export default function CorporatePage() {
  return (
    <Suspense fallback={<p className="px-6 py-16">Checking organisation access…</p>}>
      <CorporateHome />
    </Suspense>
  );
}

async function CorporateHome() {
  await connection();
  const actor = await guardDashboard("corporate", "/dashboard/corporate");
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Corporate partner</p>
      <h1 className="mt-3 font-serif text-4xl">Hello, {actor.displayName}</h1>
      <section className={`${panelClass} mt-8`}>
        <h2 className="font-serif text-2xl">Partnership desk</h2>
        <p className="mt-3 leading-7 text-ink-soft">
          This workspace is reserved for organisations. It does not include request approval, publishing, or administrator tools. Sponsoring a campaign will be added when payments are connected.
        </p>
      </section>
    </div>
  );
}

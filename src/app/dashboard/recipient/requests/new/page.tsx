import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { Suspense } from "react";

import { AssistanceForm } from "@/components/forms/assistance-form";
import { panelClass } from "@/components/ui/styles";
import { guardDashboard } from "@/server/guard";

export const metadata = { title: "New request" };

export default function NewRequestPage() {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading the form…</p>}>
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  await connection();
  await guardDashboard("recipient", "/dashboard/recipient/requests/new");
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.7fr_1.3fr]">
      <div>
        <h1 className="font-serif text-4xl">New request</h1>
        <p className="mt-4 leading-7 text-ink-soft">
          Write what a neighbour needs to know. Keep contact details and documents in the private fields. You can save a draft. Submitting is free, and an administrator decides whether anything is published.
        </p>
      </div>
      <section className={panelClass}>
        <AssistanceForm clientToken={randomUUID()} />
      </section>
    </div>
  );
}

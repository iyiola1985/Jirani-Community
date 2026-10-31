import { connection } from "next/server";
import { Suspense } from "react";

import { CampaignDraftForm } from "@/components/forms/campaign-draft-form";
import { guardDashboard } from "@/server/guard";

export const metadata = { title: "New campaign" };

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading the form…</p>}>
      <NewCampaign />
    </Suspense>
  );
}

async function NewCampaign() {
  await connection();
  await guardDashboard("administrator", "/dashboard/admin/campaigns/new");
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-serif text-4xl">New campaign</h1>
      <p className="mt-4 leading-7 text-ink-soft">
        This saves a draft. It is not public, and it cannot take gifts, until an administrator reviews and opens it.
      </p>
      <div className="mt-8">
        <CampaignDraftForm />
      </div>
    </div>
  );
}

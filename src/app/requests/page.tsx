import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";

import { RequestCard } from "@/components/requests/request-card";
import { inputClass, quietButton } from "@/components/ui/styles";
import { isDatabaseConfigured, isDemoMode } from "@/config/brand";
import { COUNTIES } from "@/data/counties";
import { categoryLabel } from "@/domain/labels";
import { CATEGORIES, type Category } from "@/domain/types";
import { listPublished, REQUEST_PAGE_SIZE } from "@/server/assistance";
import { getDemoBook } from "@/server/book";

export const metadata = { title: "Requests" };

type Search = {
  category?: string;
  county?: string;
  urgent?: string;
  funding?: string;
  page?: string;
};

export default function RequestsPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Give help</p>
      <h1 className="mt-3 font-serif text-4xl tracking-tight sm:text-5xl">Assistance requests</h1>
      <p className="mt-4 max-w-2xl text-lg leading-8 text-ink-soft">
        Only requests an administrator has published are listed. Phone numbers, identity documents, medical files, and street addresses stay in the review file.
      </p>
      <Suspense fallback={<p className="mt-8 text-ink-soft">Loading requests…</p>}>
        <RequestList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function chosenCategory(value: string | undefined): Category | null {
  return CATEGORIES.find((item) => item === value) ?? null;
}

async function RequestList({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  const query = await searchParams;
  const category = chosenCategory(query.category);
  const county = query.county && (COUNTIES as readonly string[]).includes(query.county) ? query.county : null;
  const urgent = query.urgent === "yes" ? true : null;
  const funding = query.funding === "open" || query.funding === "met" ? query.funding : "any";
  const page = Math.max(1, Number(query.page) || 1);
  const live = isDatabaseConfigured()
    ? await listPublished({ category, county, urgent, funding, page })
    : { requests: [], total: 0 };
  const demo = isDemoMode() && page === 1
    ? getDemoBook().listPublishedRequests().filter((request) => {
        if (category && request.category !== category) return false;
        if (county && request.county !== county) return false;
        if (urgent && !request.urgent) return false;
        if (funding === "open" && request.raisedMinor >= request.amountNeededMinor) return false;
        if (funding === "met" && request.raisedMinor < request.amountNeededMinor) return false;
        return true;
      })
    : [];
  const pages = Math.max(1, Math.ceil(live.total / REQUEST_PAGE_SIZE));
  return (
    <>
      <form className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <label className="text-sm font-medium">
          Category
          <select className={inputClass} name="category" defaultValue={category ?? ""}>
            <option value="">Any</option>
            {CATEGORIES.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          County
          <select className={inputClass} name="county" defaultValue={county ?? ""}>
            <option value="">Any</option>
            {COUNTIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Urgency
          <select className={inputClass} name="urgent" defaultValue={urgent ? "yes" : ""}>
            <option value="">Any</option>
            <option value="yes">Urgent</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Funding record
          <select className={inputClass} name="funding" defaultValue={funding}>
            <option value="any">Any</option>
            <option value="open">Still open</option>
            <option value="met">Recorded gifts cover the amount</option>
          </select>
        </label>
        <button className={`${quietButton} self-end`} type="submit">Apply filters</button>
      </form>
      {live.requests.length === 0 && demo.length === 0 ? (
        <p className="mt-8 text-ink-soft">No published requests match these filters.</p>
      ) : null}
      {live.requests.length > 0 ? (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {live.requests.map((request) => <RequestCard key={request.id} request={request} />)}
        </div>
      ) : null}
      {pages > 1 ? (
        <p className="mt-6 flex gap-4 text-sm font-semibold">
          {page > 1 ? <Link href={pageHref(query, page - 1)}>Previous</Link> : null}
          <span className="font-normal text-muted">Page {page} of {pages}</span>
          {page < pages ? <Link href={pageHref(query, page + 1)}>Next</Link> : null}
        </p>
      ) : null}
      {demo.length > 0 ? (
        <section className="mt-12">
          <h2 className="font-serif text-2xl">Demonstration requests</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">These records are samples. The gifts were never collected.</p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {demo.map((request) => <RequestCard key={request.id} request={request} />)}
          </div>
        </section>
      ) : null}
    </>
  );
}

function pageHref(query: Search, page: number): string {
  const params = new URLSearchParams();
  if (query.category) params.set("category", query.category);
  if (query.county) params.set("county", query.county);
  if (query.urgent) params.set("urgent", query.urgent);
  if (query.funding) params.set("funding", query.funding);
  params.set("page", String(page));
  return `/requests?${params.toString()}`;
}

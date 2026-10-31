import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { panelClass, quietButton } from "@/components/ui/styles";
import { RequestStatusPill } from "@/components/ui/status-pill";
import { isDatabaseConfigured, isDemoMode } from "@/config/brand";
import { COUNTIES } from "@/data/counties";
import { categoryLabel, requestStatusLabel } from "@/domain/labels";
import { CATEGORIES, REQUEST_STATUSES } from "@/domain/types";
import { listReviewQueue } from "@/server/assistance";
import { getDemoBook } from "@/server/book";
import { guardDashboard } from "@/server/guard";

export const metadata = { title: "Administration" };

type Search = { category?: string; county?: string; status?: string; from?: string; to?: string };

export default function AdminPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <Suspense fallback={<p className="px-6 py-16">Loading administration…</p>}>
      <AdminHome searchParams={searchParams} />
    </Suspense>
  );
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | null {
  return values.find((item) => item === value) ?? null;
}

function day(value: string | undefined, end: boolean): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return end ? `${value}T23:59:59Z` : `${value}T00:00:00Z`;
}

async function AdminHome({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  const actor = await guardDashboard("administrator", "/dashboard/admin");
  const query = await searchParams;
  const category = oneOf(CATEGORIES, query.category);
  const county = query.county && (COUNTIES as readonly string[]).includes(query.county) ? query.county : null;
  const status = oneOf(REQUEST_STATUSES, query.status);
  const live = isDatabaseConfigured()
    ? await listReviewQueue(actor, { category, county, status, from: day(query.from, false), to: day(query.to, true) })
    : [];
  const book = isDemoMode() ? getDemoBook() : null;
  const samples = book ? book.listRequestsForReview(actor).filter((request) => {
    if (category && request.category !== category) return false;
    if (county && request.county !== county) return false;
    if (status && request.status !== status) return false;
    return true;
  }) : [];
  const complaints = book ? book.listComplaints(actor) : [];
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Administrator</p>
      <h1 className="mt-3 font-serif text-4xl">Review desk</h1>
      <p className="mt-4 max-w-2xl leading-7 text-ink-soft">
        You can review requests that belong to other people. Your own request cannot be approved by you. A suspicious flag is for a person to read. It does not reject the applicant.
      </p>
      <div className="mt-6 flex flex-wrap gap-4 text-sm font-semibold">
        <Link href="/dashboard/admin/campaigns">Campaigns</Link>
        <Link href="/dashboard/admin/finance">Demonstration ledger</Link>
        <Link href="/dashboard/admin/payments">Sandbox payments</Link>
        <Link href="/dashboard/admin/reconciliation">Reconciliation</Link>
        <Link href="/transparency">Public reports</Link>
      </div>
      <form className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-6" method="get">
        <label className="text-sm font-medium">Category
          <select className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="category" defaultValue={category ?? ""}>
            <option value="">Any</option>
            {CATEGORIES.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">County
          <select className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="county" defaultValue={county ?? ""}>
            <option value="">Any</option>
            {COUNTIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Status
          <select className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" name="status" defaultValue={status ?? ""}>
            <option value="">Any</option>
            {REQUEST_STATUSES.map((item) => <option key={item} value={item}>{requestStatusLabel(item)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">From
          <input className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" type="date" name="from" defaultValue={query.from ?? ""} />
        </label>
        <label className="text-sm font-medium">To
          <input className="mt-1.5 w-full rounded-xl border border-line bg-paper px-3 py-2.5" type="date" name="to" defaultValue={query.to ?? ""} />
        </label>
        <button className={`${quietButton} self-end`} type="submit">Filter</button>
      </form>
      <section className="mt-8">
        <h2 className="font-serif text-2xl">Submitted requests</h2>
        {live.length === 0 ? <p className="mt-3 text-sm text-ink-soft">No database requests match these filters.</p> : (
          <div className="mt-4 grid gap-4">
            {live.map((request) => (
              <article key={request.id} className={panelClass}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-serif text-2xl">{request.title}</h3>
                  <RequestStatusPill status={request.status} />
                </div>
                <p className="mt-2 text-sm text-muted">{categoryLabel(request.category)} · {request.county} · {request.createdAt.slice(0, 10)}</p>
                <Link className="mt-3 inline-block text-sm font-semibold text-lagoon" href={`/dashboard/admin/requests/${request.id}`}>Open review file</Link>
              </article>
            ))}
          </div>
        )}
      </section>
      {samples.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-serif text-2xl">Demonstration queue</h2>
          <div className="mt-4 grid gap-4">
            {samples.map((request) => (
              <article key={request.id} className={panelClass}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-serif text-2xl">{request.title}</h3>
                  <RequestStatusPill status={request.status} />
                </div>
                <p className="mt-2 text-sm text-muted">{request.county} · Demonstration</p>
                <Link className="mt-3 inline-block text-sm font-semibold text-lagoon" href={`/dashboard/admin/requests/${request.id}`}>Open review file</Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section className="mt-10">
        <h2 className="font-serif text-2xl">Complaints and review requests</h2>
        {complaints.length === 0 ? <p className="mt-3 text-sm text-ink-soft">None waiting.</p> : (
          <ul className="mt-3 space-y-3">
            {complaints.map((complaint) => (
              <li key={complaint.id} className={panelClass}>
                <p className="text-sm font-semibold">{complaint.subjectType} · {complaint.status}</p>
                <p className="mt-2 text-sm leading-6">{complaint.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

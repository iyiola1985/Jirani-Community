import Link from "next/link";

import { categoryLabel } from "@/domain/labels";
import { formatKes } from "@/domain/money";
import type { PublicRequest } from "@/domain/types";
import { panelClass } from "@/components/ui/styles";
import { RequestStatusPill } from "@/components/ui/status-pill";

export function RequestCard({ request }: { request: PublicRequest }) {
  const progress = request.amountNeededMinor === 0 ? 0 : Math.min(100, Math.round((request.raisedMinor / request.amountNeededMinor) * 100));
  return (
    <article className={panelClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-gold">{categoryLabel(request.category)}</p>
        <RequestStatusPill status="published" />
      </div>
      <h2 className="mt-3 font-serif text-2xl leading-tight">
        <Link href={`/requests/${request.id}`} className="hover:underline">
          {request.title}
        </Link>
      </h2>
      <p className="mt-3 text-sm leading-6 text-ink-soft">{request.summary}</p>
      <p className="mt-4 text-sm text-muted">
        {request.county} County{request.locality ? ` · ${request.locality}` : ""} · Public name: {request.publicAlias}
        {request.urgent ? " · Urgent" : ""}
        {request.publishedAt ? ` · Published ${request.publishedAt.slice(0, 10)}` : ""}
      </p>
      <div className="mt-4" aria-hidden="true">
        <div className="h-1.5 rounded-full bg-mist">
          <div className="h-1.5 rounded-full bg-lagoon" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <p className="mt-2 text-sm text-ink">
        {formatKes(request.raisedMinor)} simulated of {formatKes(request.amountNeededMinor)}
        {" · "}
        {formatKes(Math.max(0, request.amountNeededMinor - request.raisedMinor))} still open
        {" · "}
        Demonstration ledger
      </p>
      <Link className="mt-4 inline-flex text-sm font-semibold text-lagoon" href={`/requests/${request.id}`}>
        View details
      </Link>
    </article>
  );
}

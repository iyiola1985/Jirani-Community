import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { panelClass } from "@/components/ui/styles";
import { dashboardsFor } from "@/domain/auth-access";
import { getActor } from "@/server/session";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="px-6 py-16">Opening your dashboard…</p>}>
      <Router />
    </Suspense>
  );
}

async function Router() {
  await connection();
  const actor = await getActor();
  if (!actor) redirect("/login?next=/dashboard");
  const links = dashboardsFor(actor);
  const only = links[0];
  if (links.length === 1 && only) redirect(only.href);
  if (links.length === 0) redirect("/unauthorized");
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-serif text-4xl">Choose a workspace</h1>
      <p className="mt-4 leading-7 text-ink-soft">
        This account can open {links.map((link) => link.label.toLowerCase()).join(", ")}. Each area uses the same sign-in.
      </p>
      <ul className="mt-8 grid gap-4">
        {links.map((link) => (
          <li key={link.href}>
            <Link className={`${panelClass} block`} href={link.href}>
              <span className="font-serif text-2xl">{link.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

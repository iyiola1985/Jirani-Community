import Link from "next/link";

import { dashboardsFor } from "@/domain/auth-access";
import { getActor } from "@/server/session";

export async function RoleSwitcher() {
  const actor = await getActor();
  if (!actor) return null;
  const links = dashboardsFor(actor);
  if (links.length < 2) return null;
  return (
    <nav aria-label="Your roles" className="mx-auto flex w-full max-w-6xl flex-wrap gap-2 px-4 pt-6 sm:px-6">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-full border border-line bg-paper-raised px-3 py-1.5 text-sm font-semibold"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

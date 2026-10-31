import Link from "next/link";

import { logoutAction } from "@/server/actions/auth";
import { getActor } from "@/server/session";

const headerQuietButton =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-paper-raised px-3 text-sm font-semibold text-ink hover:bg-mist sm:px-4";
const headerPrimaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-lagoon px-3 text-sm font-semibold text-white hover:bg-lagoon-deep sm:px-4";

export async function AuthMenu() {
  const actor = await getActor();
  if (!actor) {
    return (
      <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
        <Link href="/login" className={headerQuietButton}>
          Sign in
        </Link>
        <Link href="/register" className={headerPrimaryButton}>
          Register
        </Link>
      </div>
    );
  }

  return (
    <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
      <Link href="/dashboard" className="hidden max-w-40 truncate text-sm font-semibold text-ink sm:inline">
        {actor.displayName}
      </Link>
      <Link href="/dashboard/account" className={headerQuietButton}>
        Account
      </Link>
      <form action={logoutAction}>
        <button type="submit" className={headerQuietButton}>
          Sign out
        </button>
      </form>
    </div>
  );
}

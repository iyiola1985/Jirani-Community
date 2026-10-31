import Link from "next/link";
import { Suspense } from "react";

import { Logo } from "@/components/brand/logo";
import { AuthMenu } from "@/components/layout/auth-menu";
import { quietButton } from "@/components/ui/styles";
import { brand } from "@/config/brand";

const links = [
  { href: "/requests", label: "Requests" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/fees", label: "Fees" },
  { href: "/transparency", label: "Transparency" },
  { href: "/safeguarding", label: "Safeguarding" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-paper/90">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <Logo priority />
        <nav className="hidden items-center gap-5 md:flex" aria-label="Primary">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm font-medium text-ink-soft hover:text-ink">
              {link.label}
            </Link>
          ))}
        </nav>
        <Suspense fallback={<span className={`${quietButton} pointer-events-none opacity-70`}>Account</span>}>
          <AuthMenu />
        </Suspense>
      </div>
      <p className="px-4 pb-3 text-xs text-muted sm:hidden">{brand.tagline}</p>
      <details className="border-t border-line px-4 py-1 md:hidden">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Menu</summary>
        <nav className="grid gap-1 pb-2" aria-label="Mobile">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="flex min-h-11 items-center rounded-xl px-2 text-sm hover:bg-mist">
              {link.label}
            </Link>
          ))}
        </nav>
      </details>
    </header>
  );
}

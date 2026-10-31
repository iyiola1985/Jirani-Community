import Image from "next/image";
import Link from "next/link";

import { brand } from "@/config/brand";

export function Logo({ compact = false, priority = false }: { compact?: boolean; priority?: boolean }) {
  return (
    <Link href="/" className="inline-flex min-w-0 items-center gap-2.5 text-ink">
      <Image src="/brand-mark.png" alt="" width={56} height={56} priority={priority} className="h-10 w-10 shrink-0 sm:h-14 sm:w-14" />
      <span className="min-w-0">
        <span className="block font-serif text-xl leading-none tracking-tight">{brand.name}</span>
        {compact ? null : <span className="mt-1 hidden text-xs leading-4 text-muted sm:block">{brand.tagline}</span>}
      </span>
    </Link>
  );
}

import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { brand } from "@/config/brand";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-3">
        <div className="min-w-0">
          <Logo compact />
          <p className="mt-3 text-sm leading-6 text-ink-soft">
            {brand.tagline} Jirani is a community assistance platform for Kenya.
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            <a className="font-semibold text-ink underline decoration-line underline-offset-4 hover:text-lagoon" href="https://sholatech.com" rel="noopener noreferrer" target="_blank">
              Powered by sholatech.com
            </a>
          </p>
        </div>
        <div className="text-sm leading-7">
          <p className="font-semibold text-ink">The record</p>
          <Link className="block text-ink-soft hover:text-ink" href="/requests">Assistance requests</Link>
          <Link className="block text-ink-soft hover:text-ink" href="/campaigns">Campaigns</Link>
          <Link className="block text-ink-soft hover:text-ink" href="/transparency">Transparency reports</Link>
          <Link className="block text-ink-soft hover:text-ink" href="/fees">Fees and disbursements</Link>
        </div>
        <div className="text-sm leading-7">
          <p className="font-semibold text-ink">Care and terms</p>
          <Link className="block text-ink-soft hover:text-ink" href="/safeguarding">Safeguarding</Link>
          <Link className="block text-ink-soft hover:text-ink" href="/privacy">Privacy</Link>
          <Link className="block text-ink-soft hover:text-ink" href="/terms">Terms</Link>
        </div>
      </div>
    </footer>
  );
}

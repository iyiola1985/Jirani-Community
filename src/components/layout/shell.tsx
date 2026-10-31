import { isDemoMode } from "@/config/brand";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {isDemoMode() ? (
        <p className="bg-lagoon px-4 py-2 text-center text-sm text-white">
          Local demonstration only. These requests, campaigns, and payments are simulated. No real money moves, and the figures are not live results.
        </p>
      ) : null}
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}

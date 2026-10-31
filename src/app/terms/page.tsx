import { LegalLayout } from "@/components/legal-layout";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalLayout
      eyebrow="Draft notice"
      title="Terms"
      lede="These draft terms describe how this build behaves. They are not a contract and they are not legal advice."
    >
      <p>Recipients can ask for help. Donors can record a simulated gift. Administrators review requests, campaigns, and disbursement decisions. A person cannot review or publish their own request, and cannot approve a disbursement to themselves.</p>
      <p>Payments in this build are simulated. A successful screen is not a transfer. When a live provider is added later, a gift will count only after the server checks the provider. A browser redirect will not be enough.</p>
      <p>Campaigns end by a recorded decision. Ending a campaign does not pay anyone. A later reconciliation and a separate approval are required. Mistakes in the ledger are corrected with a reversal, not by editing the original amount.</p>
      <p>A flag for an unusual request sends it to a person. It does not refuse the request by itself. Someone who disagrees with a decision can write to the reviewer from the safeguarding page.</p>
    </LegalLayout>
  );
}

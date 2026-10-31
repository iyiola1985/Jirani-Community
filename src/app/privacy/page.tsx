import { LegalLayout } from "@/components/legal-layout";
import { brand } from "@/config/brand";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalLayout
      eyebrow="Draft notice"
      title="Privacy"
      lede="This is a product draft for review, not a finished privacy policy. A lawyer should approve the live version before real personal data is collected."
    >
      <p>Public pages show a chosen alias, a county, a category, and the summary the person agreed to publish. They do not show legal names, phone numbers, identity documents, medical files, details of children, or street addresses.</p>
      <p>The review file is available to the recipient who owns it and to an administrator who is not that recipient. Donors cannot open it. Anonymous gifts still keep a private link to the donor account so a receipt and a lawful record can exist.</p>
      <p>Supporting files are collected so a reviewer can check a hospital bill, loan document, damage record, or similar evidence. They are stored outside the public site. Jirani does not automatically send them to a hospital, lender, police service, or other organisation. No malware scanner is configured in this build, and video length is not measured. Jirani has not set a numbered retention period. Files stay in private storage until a reviewed deletion. That sentence is not a legal retention determination. A lawyer should confirm the live retention rule before real personal data is collected.</p>
      <p>Consent to the draft terms, the privacy notice, and publication of a summary is stored as a consent record. Evidence file bytes are not written to a public folder.</p>
      <p>A signed-in person can close the database account from the account page. That removes the password, email, phone, county, display name, private notes, and private files on that person’s requests. Gift amounts, receipts, and ledger rows stay. A name shown on a public gift is cleared. Wording already published on a request stays on that page. Internal review notes already written stay with the request. The last administrator account cannot be closed, so the review desk is not locked.</p>
      <p>{brand.legalEntity} is the organisation named on this build. The address {brand.supportEmail} is a placeholder.</p>
    </LegalLayout>
  );
}

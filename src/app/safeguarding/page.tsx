import { LegalLayout } from "@/components/legal-layout";
import { ComplaintForm } from "@/components/forms/complaint-form";

export const metadata = { title: "Safeguarding" };

export default function SafeguardingPage() {
  return (
    <LegalLayout
      eyebrow="Care"
      title="Safeguarding"
      lede="People asking for help keep their dignity. The public page describes a need. It does not expose a household."
    >
      <p>Do not put a phone number, email address, identity number, hospital file, the name of a child, or a street address in a public summary. Put contact details in the private note. A high amount is flagged for a person to read. The flag does not reject the request.</p>
      <p>If a decision feels wrong, ask for another review here. An administrator sees the message. Sending it does not change the request by itself, and it does not publish the private note.</p>
      <ComplaintForm />
    </LegalLayout>
  );
}

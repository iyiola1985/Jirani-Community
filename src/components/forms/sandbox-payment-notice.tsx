import { sandboxCanStart, sandboxNotice } from "@/server/sandbox-payments";
import { SandboxPayForm } from "@/components/forms/sandbox-pay-form";

export function SandboxPaymentNotice(props: {
  requestId?: string;
  campaignId?: string;
  nextPath: string;
  idempotencyKey: string;
  signedIn: boolean;
  donor: boolean;
}) {
  return (
    <div className="mt-6 border-t border-line pt-4">
      <h3 className="font-serif text-xl">Sandbox payment</h3>
      <p className="mt-2 text-sm leading-6 text-ink-soft">{sandboxNotice()}</p>
      {sandboxCanStart() ? <SandboxPayForm {...props} /> : null}
    </div>
  );
}

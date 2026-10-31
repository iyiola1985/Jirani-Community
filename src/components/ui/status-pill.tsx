import { campaignStatusLabel, paymentStatusLabel, requestStatusLabel, verificationStatusLabel } from "@/domain/labels";
import type { CampaignStatus, PaymentStatus, RequestStatus, VerificationStatus } from "@/domain/types";

const tone: Record<string, string> = {
  published: "bg-mist text-lagoon-deep",
  verified: "bg-mist text-lagoon-deep",
  active: "bg-mist text-lagoon-deep",
  successful: "bg-mist text-lagoon-deep",
  reported: "bg-mist text-lagoon-deep",
  pending: "bg-sand text-gold",
  submitted: "bg-sand text-gold",
  under_review: "bg-sand text-gold",
  needs_information: "bg-sand text-gold",
  reconciling: "bg-sand text-gold",
  scheduled: "bg-sand text-gold",
  approved: "bg-sand text-gold",
  draft: "bg-paper text-muted",
  closed: "bg-paper text-muted",
  failed: "bg-[#f8e8e4] text-clay",
  rejected: "bg-[#f8e8e4] text-clay",
  reversed: "bg-[#f8e8e4] text-clay",
  suspended: "bg-[#f8e8e4] text-clay",
  cancelled: "bg-[#f8e8e4] text-clay",
};

export function StatusPill({ status, label }: { status: string; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tone[status] ?? "bg-paper text-ink"}`}>
      {label}
    </span>
  );
}

export function RequestStatusPill({ status }: { status: RequestStatus }) {
  return <StatusPill status={status} label={requestStatusLabel(status)} />;
}

export function CampaignStatusPill({ status }: { status: CampaignStatus }) {
  return <StatusPill status={status} label={campaignStatusLabel(status)} />;
}

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  return <StatusPill status={status} label={paymentStatusLabel(status)} />;
}

export function VerificationStatusPill({ status }: { status: VerificationStatus }) {
  return <StatusPill status={status} label={verificationStatusLabel(status)} />;
}

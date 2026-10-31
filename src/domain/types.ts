import type { Currency } from "@/domain/money";

export const ROLES = ["recipient", "donor", "corporate_partner", "administrator"] as const;
export const SELF_SERVICE_ROLES = ["recipient", "donor", "corporate_partner"] as const;
export type SelfServiceRole = (typeof SELF_SERVICE_ROLES)[number];
export type Role = (typeof ROLES)[number];

export const CATEGORIES = [
  "food",
  "rent",
  "electricity",
  "cooking_gas",
  "internet",
  "school",
  "school_supplies",
  "medical",
  "medication",
  "surgery",
  "maternity",
  "funeral",
  "clothing",
  "hygiene",
  "transport",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const REQUEST_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "needs_information",
  "verified",
  "rejected",
  "published",
  "suspended",
  "closed",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  "not_started",
  "submitted",
  "under_review",
  "verified",
  "needs_information",
  "rejected",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const CAMPAIGN_STATUSES = [
  "draft",
  "under_review",
  "approved",
  "scheduled",
  "active",
  "closed",
  "reconciling",
  "reported",
  "cancelled",
] as const;

export const CAMPAIGN_CATEGORIES = [
  "food",
  "rent",
  "school",
  "medical",
  "hygiene",
  "maternity",
  "funeral",
  "clothing",
  "other",
] as const;
export type CampaignCategory = (typeof CAMPAIGN_CATEGORIES)[number];
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const PAYMENT_STATUSES = ["pending", "successful", "failed", "reversed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FEE_PAYERS = ["donor", "campaign", "platform_absorbed", "optional_donor"] as const;
export type FeePayer = (typeof FEE_PAYERS)[number];

export type Actor = {
  id: string;
  roles: readonly Role[];
  displayName: string;
};

export type FeeRule = {
  id: string;
  name: string;
  appliesTo: "assistance_request" | "campaign";
  campaignType: string | null;
  rateBps: number | null;
  fixedMinor: number | null;
  payer: FeePayer;
  active: boolean;
  demoOnly: boolean;
};

export type EvidenceMeta = {
  id: string;
  requestId: string;
  ownerId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  /** Null when the bytes were not kept. Metadata alone is not a document. */
  storageKey: string | null;
  createdAt: string;
};

export type RequestRecord = {
  id: string;
  ownerId: string;
  publicAlias: string;
  category: Category;
  title: string;
  summary: string;
  county: string;
  amountNeededMinor: number;
  currency: Currency;
  status: RequestStatus;
  privateNotes: string;
  demo: boolean;
  flags: readonly string[];
  createdAt: string;
};

export type PublicRequest = {
  id: string;
  publicAlias: string;
  category: Category;
  title: string;
  summary: string;
  county: string;
  amountNeededMinor: number;
  raisedMinor: number;
  currency: Currency;
  status: "published";
  demo: boolean;
  urgent?: boolean;
  locality?: string;
  publishedAt?: string | null;
};

export type CampaignRecord = {
  id: string;
  title: string;
  objective: string;
  targetMinor: number;
  currency: Currency;
  startsAt: string;
  endsAt: string;
  eligibilityCriteria: string;
  beneficiarySelectionRules: string;
  feeDisclosure: string;
  refundPolicy: string;
  surplusPolicy: string;
  status: CampaignStatus;
  demo: boolean;
};

export type Allocation = {
  id: string;
  campaignId: string;
  requestId: string | null;
  description: string;
  amountMinor: number;
  rationale: string;
  approvedBy: string;
  approvedAt: string;
};

export type Contribution = {
  readonly id: string;
  readonly donorId: string;
  readonly requestId: string | null;
  readonly campaignId: string | null;
  readonly recognition: "public" | "anonymous";
  readonly publicName: string | null;
  readonly giftMinor: number;
  readonly collectedPlatformFeeMinor: number;
  readonly campaignBorneFeeMinor: number;
  readonly providerFeeMinor: number;
  readonly donorPaysMinor: number;
  readonly netToCauseMinor: number;
  readonly currency: Currency;
  readonly idempotencyKey: string;
  readonly provider: "mock";
  readonly providerReference: string;
  readonly simulated: true;
  readonly createdAt: string;
  status: PaymentStatus;
  receiptNumber: string | null;
};

export type PublicAcknowledgement = {
  id: string;
  displayName: string;
  giftMinor: number;
  currency: Currency;
  simulated: true;
};

export type RefundRecord = {
  readonly id: string;
  readonly contributionId: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly approvedBy: string;
  readonly simulated: true;
};

export type LedgerEffect =
  | "increase_cause"
  | "decrease_cause"
  | "increase_platform_revenue"
  | "decrease_platform_revenue"
  | "provider_cost"
  | "disbursement_approved";

export type LedgerEntry = {
  readonly id: string;
  readonly kind: "gift" | "platform_fee" | "provider_fee" | "refund" | "disbursement";
  readonly effect: LedgerEffect;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly requestId: string | null;
  readonly campaignId: string | null;
  readonly contributionId: string | null;
  readonly disbursementId: string | null;
  readonly createdAt: string;
  readonly memo: string;
};

export type Disbursement = {
  readonly id: string;
  readonly campaignId: string | null;
  readonly requestId: string | null;
  readonly beneficiaryOwnerId: string | null;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly status: "approved" | "rejected";
  /** This milestone records the decision only. The type forbids a sent transfer. */
  readonly fundsSent: false;
  readonly providerTransferReference: null;
  readonly reason: string;
  readonly decidedBy: string;
  readonly createdAt: string;
};

export type ReportRecord = {
  id: string;
  campaignId: string;
  narrative: string;
  grossGiftMinor: number;
  platformFeeMinor: number;
  netGiftMinor: number;
  disbursementApprovedMinor: number;
  currency: Currency;
  publishedAt: string;
  publishedBy: string;
  demo: boolean;
};

export type AuditEntry = {
  readonly id: string;
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly metadata: Readonly<Record<string, string>>;
};

export type VerificationRecord = {
  profileId: string;
  status: VerificationStatus;
  /** Retained for administrators. Never copied onto a public request. */
  legalName: string;
};

export type ConsentRecord = {
  id: string;
  profileId: string;
  consentType: "terms" | "privacy" | "request_publication" | "verification";
  policyVersion: string;
  grantedAt: string;
};

export type Complaint = {
  id: string;
  reporterId: string | null;
  subjectType: "request" | "campaign" | "contribution" | "platform";
  subjectId: string | null;
  body: string;
  status: "open" | "in_review" | "resolved";
  createdAt: string;
};

export type PaymentEventRecord = {
  readonly id: string;
  readonly contributionId: string;
  readonly providerEventId: string;
  readonly outcome: "accepted" | "duplicate" | "rejected";
  readonly verifiedStatus: PaymentStatus;
  readonly createdAt: string;
};

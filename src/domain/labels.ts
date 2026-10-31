import { assertNever } from "@/domain/assert-never";
import type {
  CampaignStatus,
  Category,
  PaymentStatus,
  RequestStatus,
  VerificationStatus,
} from "@/domain/types";

export function categoryLabel(category: Category): string {
  switch (category) {
    case "food":
      return "Food and essential groceries";
    case "rent":
      return "Rent and housing";
    case "electricity":
      return "Electricity tokens and utilities";
    case "cooking_gas":
      return "Cooking gas";
    case "internet":
      return "Internet and communication";
    case "school":
      return "School fees and education";
    case "school_supplies":
      return "Uniforms, books and school supplies";
    case "medical":
      return "Medical bills";
    case "medication":
      return "Medication and treatment";
    case "surgery":
      return "Surgery, ICU and newborn care";
    case "maternity":
      return "Maternity and childbirth expenses";
    case "funeral":
      return "Funeral and bereavement expenses";
    case "clothing":
      return "Clothing and personal essentials";
    case "hygiene":
      return "Sanitary towels, diapers and hygiene products";
    case "transport":
      return "Emergency transport";
    case "other":
      return "Other verified essential needs";
    default:
      return assertNever(category);
  }
}

export function requestStatusLabel(status: RequestStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "submitted":
      return "Submitted";
    case "under_review":
      return "Under review";
    case "needs_information":
      return "Needs information";
    case "verified":
      return "Verified";
    case "rejected":
      return "Rejected";
    case "published":
      return "Published";
    case "suspended":
      return "Suspended";
    case "closed":
      return "Closed";
    default:
      return assertNever(status);
  }
}

export function campaignStatusLabel(status: CampaignStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "under_review":
      return "Under review";
    case "approved":
      return "Approved";
    case "scheduled":
      return "Scheduled";
    case "active":
      return "Active";
    case "closed":
      return "Closed";
    case "reconciling":
      return "Reconciling";
    case "reported":
      return "Report published";
    case "cancelled":
      return "Cancelled";
    default:
      return assertNever(status);
  }
}

export function paymentStatusLabel(status: PaymentStatus): string {
  switch (status) {
    case "pending":
      return "Pending simulation";
    case "successful":
      return "Simulated success";
    case "failed":
      return "Simulated failure";
    case "reversed":
      return "Simulated reversal";
    default:
      return assertNever(status);
  }
}

export function verificationStatusLabel(status: VerificationStatus): string {
  switch (status) {
    case "not_started":
      return "Not started";
    case "submitted":
      return "Submitted";
    case "under_review":
      return "Under review";
    case "verified":
      return "Verified";
    case "needs_information":
      return "Needs information";
    case "rejected":
      return "Rejected";
    default:
      return assertNever(status);
  }
}

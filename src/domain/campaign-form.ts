import { COUNTIES } from "@/data/counties";
import { DomainError } from "@/domain/errors";
import { shillingsToMinor } from "@/domain/money";
import { CAMPAIGN_CATEGORIES, type CampaignCategory } from "@/domain/types";

export type CampaignDraftInput = {
  title: string;
  slug: string;
  category: string;
  objective: string;
  amountShillings: string;
  startsAt: string;
  endsAt: string;
  county: string;
  beneficiaryGroup: string;
  eligibilityCriteria: string;
  selectionRules: string;
  feeDisclosure: string;
  refundPolicy: string;
  surplusPolicy: string;
  cancellationAllowed: boolean;
};

export type ValidCampaignDraft = {
  title: string;
  slug: string;
  category: CampaignCategory;
  objective: string;
  targetMinor: number;
  startsAt: string;
  endsAt: string;
  county: string;
  beneficiaryGroup: string;
  eligibilityCriteria: string;
  selectionRules: string;
  feeDisclosure: string;
  refundPolicy: string;
  surplusPolicy: string;
  cancellationAllowed: boolean;
};

export function campaignSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (slug.length < 3) {
    throw new DomainError("validation", "The campaign link must use lowercase letters, numbers, and hyphens.");
  }
  return slug;
}

function requiredText(value: string, label: string, min: number, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new DomainError("validation", `${label} must be between ${min} and ${max} characters.`);
  }
  return trimmed;
}

function nairobiTime(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new DomainError("validation", `Choose a valid ${label}.`);
  }
  const parsed = new Date(`${value}:00+03:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError("validation", `Choose a valid ${label}.`);
  }
  return parsed.toISOString();
}

export function validateCampaignDraft(input: CampaignDraftInput): ValidCampaignDraft {
  const title = requiredText(input.title, "The title", 8, 120);
  const slug = campaignSlug(input.slug.trim() || title);
  const category = CAMPAIGN_CATEGORIES.find((item) => item === input.category);
  if (!category) throw new DomainError("validation", "Choose a campaign category.");
  const county = input.county === "Kenya" || (COUNTIES as readonly string[]).includes(input.county) ? input.county : "";
  if (!county) throw new DomainError("validation", "Choose a county, or Kenya for a countrywide campaign.");
  const shillings = Number(input.amountShillings);
  if (!Number.isInteger(shillings) || shillings < 100) {
    throw new DomainError("validation", "Enter a whole number of shillings, at least KES 100.");
  }
  const startsAt = nairobiTime(input.startsAt, "opening date");
  const endsAt = nairobiTime(input.endsAt, "closing date");
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw new DomainError("validation", "The closing date must be after the opening date.");
  }
  return {
    title,
    slug,
    category,
    objective: requiredText(input.objective, "The objective", 40, 2000),
    targetMinor: shillingsToMinor(shillings),
    startsAt,
    endsAt,
    county,
    beneficiaryGroup: requiredText(input.beneficiaryGroup, "The beneficiary group", 8, 200),
    eligibilityCriteria: requiredText(input.eligibilityCriteria, "The eligibility rules", 40, 2000),
    selectionRules: requiredText(input.selectionRules, "The selection method", 40, 2000),
    feeDisclosure: requiredText(input.feeDisclosure, "The fee policy", 20, 2000),
    refundPolicy: requiredText(input.refundPolicy, "The refund policy", 20, 2000),
    surplusPolicy: requiredText(input.surplusPolicy, "The surplus policy", 20, 2000),
    cancellationAllowed: input.cancellationAllowed,
  };
}

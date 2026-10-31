import { publicDisclosureIssues } from "@/domain/access";
import { roleForNewAccount } from "@/domain/auth-access";
import { MAX_AMOUNT_MINOR } from "@/domain/money";
import { normalizeKenyanPhone } from "@/domain/phone";
import { CATEGORIES, type Category, type RequestStatus, type SelfServiceRole } from "@/domain/types";

export type FieldErrors = Record<string, string>;

export type RegistrationInput = {
  displayName: string;
  email: string;
  password: string;
  role: string;
  acceptedTerms: boolean;
  phone?: string;
  county?: string;
};

export type ValidRegistration = {
  displayName: string;
  email: string;
  password: string;
  role: SelfServiceRole;
  acceptedTerms: true;
  phone: string | null;
  county: string | null;
};

export function validateRegistration(
  input: RegistrationInput,
  counties: readonly string[] = [],
): { ok: true; value: ValidRegistration } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const displayName = input.displayName.trim();
  const email = input.email.trim().toLowerCase();
  const county = input.county?.trim() ?? "";
  const phoneInput = input.phone?.trim() ?? "";
  let phone: string | null = null;
  if (displayName.length < 2 || displayName.length > 80) {
    errors.displayName = "Use a display name between 2 and 80 characters.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  if (input.password.length < 10) errors.password = "Use at least 10 characters.";
  if (input.role === "administrator") {
    errors.role = "Administrator access is granted by the organisation, not at registration.";
  } else if (!roleForNewAccount(input.role)) {
    errors.role = "Choose recipient, donor, or corporate partner.";
  }
  if (phoneInput) {
    phone = normalizeKenyanPhone(phoneInput);
    if (!phone) errors.phone = "Enter a Kenyan mobile number, such as 0712 345 678.";
  }
  if (county && !counties.includes(county)) errors.county = "Choose a county, or leave it blank.";
  if (!input.acceptedTerms) errors.acceptedTerms = "Accept the draft terms and privacy notice to continue.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const role = roleForNewAccount(input.role);
  if (!role) return { ok: false, errors: { role: "Choose recipient, donor, or corporate partner." } };
  return {
    ok: true,
    value: {
      displayName,
      email,
      password: input.password,
      role,
      acceptedTerms: true,
      phone,
      county: county || null,
    },
  };
}

const STREET_ADDRESS = /\b(plot|house\s*number|house\s*no|apartment|flat\s*no|door\s*no)\b/i;

export type RequestFormInput = {
  category: string;
  title: string;
  summary: string;
  county: string;
  amountShillings: string;
  publicAlias: string;
  privateNotes: string;
  acceptedPublication: boolean;
  locality?: string;
  urgent?: boolean;
  reason?: string;
  preferredAssistance?: string;
  accurate?: boolean;
  understandsVerification?: boolean;
  understandsNoGuarantee?: boolean;
  understandsPrivate?: boolean;
  acceptedPrivacy?: boolean;
  mode?: "draft" | "submit";
};

export type ValidRequestForm = {
  category: Category;
  title: string;
  summary: string;
  county: string;
  amountMinor: number;
  publicAlias: string;
  privateNotes: string;
  locality: string;
  urgent: boolean;
  reason: string;
  preferredAssistance: Category;
};

export function validateRequestForm(
  input: RequestFormInput,
  counties: readonly string[],
): { ok: true; value: ValidRequestForm } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const title = input.title.trim();
  const summary = input.summary.trim();
  const publicAlias = input.publicAlias.trim();
  const privateNotes = input.privateNotes.trim();
  const locality = input.locality?.trim() ?? "";
  const reason = input.reason?.trim() ?? "";
  const preferred = input.preferredAssistance?.trim() || input.category;
  const submitting = input.mode !== "draft";
  if (!CATEGORIES.includes(input.category as Category)) errors.category = "Choose a category.";
  if (!CATEGORIES.includes(preferred as Category)) {
    errors.preferredAssistance = "Choose the kind of assistance that would help.";
  }
  if (title.length < 8 || title.length > 120) errors.title = "Use a title between 8 and 120 characters.";
  if (summary.length < 40 || summary.length > 800) {
    errors.summary = "Write a public summary between 40 and 800 characters.";
  }
  if (publicAlias.length < 2 || publicAlias.length > 60) {
    errors.publicAlias = "Choose a public name between 2 and 60 characters.";
  }
  if (!counties.includes(input.county)) errors.county = "Choose a county. Do not enter a street address.";
  if (locality.length > 80) errors.locality = "Keep the general area under 80 characters.";
  if (locality && (STREET_ADDRESS.test(locality) || publicDisclosureIssues(locality).length > 0)) {
    errors.locality = "Name a general area, such as a town or ward. Leave out a plot, house number, or phone number.";
  }
  if (privateNotes.length > 2000) errors.privateNotes = "Keep the private note under 2000 characters.";
  if (reason.length > 2000) errors.reason = "Keep the reason under 2000 characters.";
  if (submitting && !input.acceptedPublication) {
    errors.acceptedPublication = "Confirm that the public summary may be shown if the request is approved.";
  }
  if (submitting && !input.accurate) {
    errors.accurate = "Confirm that the information is accurate to the best of your knowledge.";
  }
  if (submitting && !input.understandsVerification) {
    errors.understandsVerification = "Confirm that you understand verification may be required.";
  }
  if (submitting && !input.understandsNoGuarantee) {
    errors.understandsNoGuarantee = "Confirm that submitting an application does not guarantee funding.";
  }
  if (submitting && !input.understandsPrivate) {
    errors.understandsPrivate = "Confirm that private documents are not published automatically.";
  }
  if (submitting && !input.acceptedPrivacy) {
    errors.acceptedPrivacy = "Confirm that public information follows the privacy notice.";
  }

  const shillings = Number(input.amountShillings);
  if (!Number.isInteger(shillings) || shillings < 100 || shillings * 100 > MAX_AMOUNT_MINOR) {
    errors.amountShillings = "Enter a whole number of shillings from 100 up to 2,000,000.";
  }

  for (const [field, value] of [
    ["title", title],
    ["summary", summary],
    ["publicAlias", publicAlias],
    ["locality", locality],
  ] as const) {
    if (publicDisclosureIssues(value).length > 0) {
      errors[field] = "Remove phone numbers, email addresses, and long numbers from public text.";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      category: input.category as Category,
      title,
      summary,
      county: input.county,
      amountMinor: shillings * 100,
      publicAlias,
      privateNotes,
      locality,
      urgent: input.urgent === true,
      reason,
      preferredAssistance: preferred as Category,
    },
  };
}

export function submissionIntent(
  existing: RequestStatus | null,
  intent: "draft" | "submit",
): "insert" | "update" | "duplicate" {
  if (!existing) return "insert";
  const editable = existing === "draft" || existing === "needs_information";
  if (editable && (intent === "draft" || intent === "submit")) return "update";
  return "duplicate";
}

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("://")) {
    return "/dashboard";
  }
  return value;
}

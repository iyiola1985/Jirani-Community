import { DomainError } from "@/domain/errors";
import type { PublicRequest, RequestRecord } from "@/domain/types";

const PHONE = /(?:\+254|0)7\d{8}/;
const EMAIL = /\S+@\S+\.\S+/;
const LONG_NUMBER = /\d{6,}/;

export function publicDisclosureIssues(text: string): string[] {
  const issues: string[] = [];
  if (PHONE.test(text.replaceAll(/\s+/g, ""))) issues.push("phone_number");
  if (EMAIL.test(text)) issues.push("email_address");
  if (LONG_NUMBER.test(text)) issues.push("long_number");
  return issues;
}

export function assertPublicTextSafe(text: string, label: string): void {
  const issues = publicDisclosureIssues(text);
  if (issues.length > 0) {
    throw new DomainError(
      "public_disclosure",
      `${label} includes contact details or a long number. Keep those in the private note.`,
    );
  }
}

export function toPublicRequest(record: RequestRecord, raisedMinor: number): PublicRequest | null {
  if (record.status !== "published") return null;
  return {
    id: record.id,
    publicAlias: record.publicAlias,
    category: record.category,
    title: record.title,
    summary: record.summary,
    county: record.county,
    amountNeededMinor: record.amountNeededMinor,
    raisedMinor,
    currency: record.currency,
    status: "published",
    demo: record.demo,
  };
}

export function publicRequestText(record: RequestRecord): string {
  return JSON.stringify(toPublicRequest(record, 0));
}

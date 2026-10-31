import { DomainError } from "@/domain/errors";

export const CURRENCY = "KES" as const;
export type Currency = typeof CURRENCY;

/** Largest single amount the domain will accept: KES 2,000,000. */
export const MAX_AMOUNT_MINOR = 200_000_000;

export function assertMinor(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT_MINOR) {
    throw new DomainError(
      "invalid_amount",
      `${label} must be a whole number of cents between 0 and KES 2,000,000.`,
    );
  }
}

export function shillingsToMinor(shillings: number): number {
  if (!Number.isInteger(shillings) || shillings < 0) {
    throw new DomainError("invalid_amount", "Enter a whole number of shillings.");
  }
  const minor = shillings * 100;
  assertMinor(minor, "Amount");
  return minor;
}

/** Smallest simulated gift on a published request: KES 100, stored as 10,000 cents. */
export function simulatedGiftMinor(shillings: number): number {
  if (!Number.isInteger(shillings)) {
    throw new DomainError("invalid_amount", "Enter a whole number of shillings.");
  }
  if (shillings < 100) {
    throw new DomainError("invalid_amount", "The smallest simulated gift is KES 100.");
  }
  return shillingsToMinor(shillings);
}

/** Half-up integer division. Both inputs must be safe integers. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0
  ) {
    throw new DomainError("invalid_amount", "Fee maths received a value that is not an exact integer.");
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

export function formatKes(minor: number): string {
  if (!Number.isSafeInteger(minor)) {
    throw new DomainError("invalid_amount", "Cannot format a non-integer amount.");
  }
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  const shillings = Math.trunc(absolute / 100);
  const cents = absolute % 100;
  const formatted = new Intl.NumberFormat("en-KE").format(shillings);
  if (cents === 0) return `${sign}Ksh ${formatted}`;
  return `${sign}Ksh ${formatted}.${cents.toString().padStart(2, "0")}`;
}

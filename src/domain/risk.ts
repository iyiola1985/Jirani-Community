/** Amounts at or above this are flagged for a person to review. They are not refused. */
export const MANUAL_REVIEW_MINOR = 20_000_000;

export type RiskAssessment = {
  flags: string[];
  autoReject: false;
  requiresManualReview: boolean;
};

export function assessRequestRisk(input: { amountMinor: number; summary: string }): RiskAssessment {
  const flags: string[] = [];
  if (input.amountMinor >= MANUAL_REVIEW_MINOR) flags.push("high_amount");
  if (input.summary.length > 600) flags.push("long_public_summary");
  return {
    flags,
    autoReject: false,
    requiresManualReview: flags.length > 0,
  };
}

/**
 * Permanent Daraja ledger gate.
 *
 * The STK Query response does not include the amount paid. Support for
 * verifying an STK receipt through Transaction Status has not been established.
 * An STK callback, an STK Query response, a Transaction Status acknowledgement,
 * a Transaction Status result, and a timeout notification are not authoritative
 * evidence. This decision is the only Daraja posting decision, and it does not
 * authorize a contribution or a ledger entry. A future post would need a new
 * decision based on documented evidence. That path is not implemented.
 */
export const DARAJA_LEDGER_POSTING_ENABLED = false;

export const DARAJA_EVIDENCE_KINDS = [
  "stk-callback",
  "stk-query",
  "transaction-status-acknowledgement",
  "transaction-status-result",
  "transaction-status-timeout",
] as const;

export type DarajaEvidenceKind = (typeof DARAJA_EVIDENCE_KINDS)[number];

export type DarajaLedgerDecision = {
  evidence: DarajaEvidenceKind;
  postContribution: false;
  postLedger: false;
  reason: "daraja-posting-disabled";
};

export function decideDarajaLedgerPost(evidence: DarajaEvidenceKind): DarajaLedgerDecision {
  switch (evidence) {
    case "stk-callback":
    case "stk-query":
    case "transaction-status-acknowledgement":
    case "transaction-status-result":
    case "transaction-status-timeout":
      return { evidence, postContribution: false, postLedger: false, reason: "daraja-posting-disabled" };
    default: {
      const unreachable: never = evidence;
      return unreachable;
    }
  }
}

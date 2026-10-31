import { createHash, randomUUID } from "node:crypto";

import { toPublicRequest } from "@/domain/access";
import { assertDisbursementAllowed, campaignTotals, transitionCampaign, type CampaignTotals } from "@/domain/campaigns";
import { DomainError } from "@/domain/errors";
import { getChargeableFeeRule, quoteFee, type FeeQuote } from "@/domain/fees";
import { assertMinor } from "@/domain/money";
import { MockPaymentProvider, statusAfterBrowserReturn, type CallbackInput } from "@/domain/payments";
import { assertAllowed } from "@/domain/permissions";
import { transitionRequest } from "@/domain/requests";
import { assessRequestRisk } from "@/domain/risk";
import type {
  Actor,
  Allocation,
  AuditEntry,
  CampaignRecord,
  Complaint,
  ConsentRecord,
  Contribution,
  Disbursement,
  EvidenceMeta,
  FeeRule,
  LedgerEntry,
  PaymentEventRecord,
  PublicAcknowledgement,
  PublicRequest,
  RefundRecord,
  ReportRecord,
  RequestRecord,
  RequestStatus,
  VerificationRecord,
  VerificationStatus,
} from "@/domain/types";

import { evidenceByteLimit, MAX_EVIDENCE_FILES, safeEvidenceLabel } from "@/domain/evidence";

export type BookSeed = {
  requests: RequestRecord[];
  campaigns: CampaignRecord[];
  contributions: Contribution[];
  refunds: RefundRecord[];
  disbursements: Disbursement[];
  reports: ReportRecord[];
  allocations: Allocation[];
  evidence: EvidenceMeta[];
  verifications: VerificationRecord[];
  consents: ConsentRecord[];
  complaints: Complaint[];
  audit: AuditEntry[];
  feeRules: FeeRule[];
};

export class AssistanceBook {
  private requests: RequestRecord[];
  private campaigns: CampaignRecord[];
  private contributions: Contribution[];
  private refunds: RefundRecord[];
  private disbursements: Disbursement[];
  private reports: ReportRecord[];
  private allocations: Allocation[];
  private evidence: EvidenceMeta[];
  private verifications: VerificationRecord[];
  private consents: ConsentRecord[];
  private complaints: Complaint[];
  private audit: AuditEntry[];
  private ledger: LedgerEntry[] = [];
  private events: PaymentEventRecord[] = [];
  private feeRules: FeeRule[];
  private receiptSequence: number;
  private readonly provider: MockPaymentProvider;

  private constructor(seed: BookSeed, provider: MockPaymentProvider) {
    this.requests = seed.requests.map((item) => ({ ...item, flags: [...item.flags] }));
    this.campaigns = seed.campaigns.map((item) => ({ ...item }));
    this.contributions = seed.contributions.map((item) => ({ ...item }));
    this.refunds = seed.refunds.map((item) => ({ ...item }));
    this.disbursements = seed.disbursements.map((item) => ({ ...item }));
    this.reports = seed.reports.map((item) => ({ ...item }));
    this.allocations = seed.allocations.map((item) => ({ ...item }));
    this.evidence = seed.evidence.map((item) => ({ ...item }));
    this.verifications = seed.verifications.map((item) => ({ ...item }));
    this.consents = seed.consents.map((item) => ({ ...item }));
    this.complaints = seed.complaints.map((item) => ({ ...item }));
    this.audit = seed.audit.map((item) => ({ ...item }));
    this.feeRules = seed.feeRules.map((item) => ({ ...item }));
    this.provider = provider;
    this.receiptSequence = 1;
    for (const contribution of this.contributions) {
      this.provider.seedSettled({
        providerReference: contribution.providerReference,
        idempotencyKey: contribution.idempotencyKey,
        amountMinor: contribution.donorPaysMinor,
        status: contribution.status === "reversed" ? "successful" : contribution.status,
        clientReference: contribution.id,
      });
      if (contribution.receiptNumber) this.receiptSequence += 1;
      if (contribution.status === "successful" || contribution.status === "reversed") {
        this.appendSettlementLedger(contribution);
      }
    }
    for (const refund of this.refunds) {
      const contribution = this.mustContribution(refund.contributionId);
      this.provider.refund({
        providerReference: contribution.providerReference,
        amountMinor: refund.amountMinor,
        idempotencyKey: refund.idempotencyKey,
      });
      this.appendRefundLedger(refund, contribution);
    }
    for (const contribution of this.contributions) {
      const refunded = this.refundedMinor(contribution.id);
      if (contribution.status === "reversed" && refunded !== contribution.netToCauseMinor) {
        throw new DomainError("seed", "A reversed demonstration contribution needs refunds equal to the amount recorded for the cause.");
      }
    }
    for (const disbursement of this.disbursements) this.appendDisbursementLedger(disbursement);
  }

  static fromSeed(seed: BookSeed, providerSecret: string): AssistanceBook {
    return new AssistanceBook(seed, new MockPaymentProvider(providerSecret));
  }

  listPublishedRequests(): PublicRequest[] {
    return this.requests
      .map((request) => toPublicRequest(request, this.raisedMinor(request.id)))
      .filter((request): request is PublicRequest => request !== null);
  }

  listCampaigns(): CampaignRecord[] {
    return this.campaigns.map((campaign) => ({ ...campaign }));
  }

  getCampaign(id: string): CampaignRecord | null {
    const campaign = this.campaigns.find((item) => item.id === id);
    return campaign ? { ...campaign } : null;
  }

  getPublicRequest(id: string): PublicRequest | null {
    const request = this.requests.find((item) => item.id === id);
    if (!request) return null;
    return toPublicRequest(request, this.raisedMinor(request.id));
  }

  listOwnedRequests(actor: Actor): RequestRecord[] {
    assertAllowed(actor, "request:create");
    return this.requests
      .filter((request) => request.ownerId === actor.id)
      .map((request) => this.copyRequest(request));
  }

  listRequestsForReview(actor: Actor): RequestRecord[] {
    assertAllowed(actor, "request:read_any_private");
    return this.requests
      .filter((request) => request.ownerId !== actor.id)
      .map((request) => this.copyRequest(request));
  }

  readRequest(actor: Actor, id: string): RequestRecord {
    const request = this.mustRequest(id);
    if (actor.id === request.ownerId && actor.roles.includes("recipient")) {
      assertAllowed(actor, "request:read_own_private", { type: "request", ownerId: request.ownerId });
      return this.copyRequest(request);
    }
    assertAllowed(actor, "request:read_any_private");
    if (request.ownerId === actor.id) {
      throw new DomainError("forbidden", "You cannot review your own assistance request.");
    }
    return this.copyRequest(request);
  }

  submitRequest(input: {
    actor: Actor;
    request: Omit<RequestRecord, "id" | "ownerId" | "status" | "flags" | "createdAt" | "currency">;
    now?: string;
  }): { request: RequestRecord; audit: AuditEntry[] } {
    assertAllowed(input.actor, "request:create");
    const now = input.now ?? new Date().toISOString();
    const risk = assessRequestRisk({
      amountMinor: input.request.amountNeededMinor,
      summary: input.request.summary,
    });
    const draft: RequestRecord = {
      ...input.request,
      id: randomUUID(),
      ownerId: input.actor.id,
      currency: "KES",
      status: "draft",
      flags: risk.flags,
      createdAt: now,
    };
    this.requests.push(draft);
    const submitted = transitionRequest({
      request: draft,
      to: "submitted",
      actor: input.actor,
      reason: "",
      ownerVerificationStatus: this.verificationStatus(input.actor.id),
      now,
    });
    this.replaceRequest(submitted);
    const audits = [
      this.record(input.actor.id, "request.submitted", "assistance_request", submitted.id, "Recipient submitted a request.", {}, now),
    ];
    if (risk.requiresManualReview) {
      audits.push(
        this.record(
          input.actor.id,
          "suspicious_activity_flagged",
          "assistance_request",
          submitted.id,
          "Flagged for manual review. The request was not refused automatically.",
          { flags: risk.flags.join(",") },
          now,
        ),
      );
    }
    this.consents.push({
      id: randomUUID(),
      profileId: input.actor.id,
      consentType: "request_publication",
      policyVersion: "draft-2026-10",
      grantedAt: now,
    });
    return { request: this.copyRequest(submitted), audit: audits };
  }

  addEvidenceMetadata(input: {
    actor: Actor;
    requestId: string;
    fileName: string;
    contentType: string;
    byteSize: number;
    sha256: string;
    now?: string;
  }): EvidenceMeta {
    const request = this.mustRequest(input.requestId);
    assertAllowed(input.actor, "evidence:upload_own", { type: "evidence", ownerId: request.ownerId });
    if (input.actor.id !== request.ownerId) {
      throw new DomainError("forbidden", "You can only attach evidence to your own request.");
    }
    if (!["draft", "submitted", "needs_information", "under_review"].includes(request.status)) {
      throw new DomainError("evidence", "Evidence can be added while the request is still being prepared or reviewed.");
    }
    const limit = evidenceByteLimit(input.contentType);
    const existing = this.evidence.filter((item) => item.requestId === request.id).length;
    if (existing >= MAX_EVIDENCE_FILES) {
      throw new DomainError("evidence", "This application already has the maximum number of files.");
    }
    if (limit === null || input.byteSize < 1 || input.byteSize > limit) {
      throw new DomainError("evidence", "Attach a PDF, image, or video within the size limit. Video is optional.");
    }
    if (input.fileName.includes("/") || input.fileName.includes("\\") || input.fileName !== safeEvidenceLabel(input.fileName)) {
      throw new DomainError("evidence", "Use a plain file name.");
    }
    const meta: EvidenceMeta = {
      id: randomUUID(),
      requestId: request.id,
      ownerId: request.ownerId,
      fileName: input.fileName,
      contentType: input.contentType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      storageKey: null,
      createdAt: input.now ?? new Date().toISOString(),
    };
    this.evidence.push(meta);
    return { ...meta };
  }

  readEvidence(actor: Actor, requestId: string): EvidenceMeta[] {
    const request = this.mustRequest(requestId);
    assertAllowed(actor, "evidence:read", { type: "evidence", ownerId: request.ownerId });
    return this.evidence.filter((item) => item.requestId === requestId).map((item) => ({ ...item }));
  }

  reviewRequest(input: {
    actor: Actor;
    requestId: string;
    to: RequestStatus;
    reason: string;
    now?: string;
  }): { request: RequestRecord; audit: AuditEntry } {
    const current = this.mustRequest(input.requestId);
    const now = input.now ?? new Date().toISOString();
    const next = transitionRequest({
      request: current,
      to: input.to,
      actor: input.actor,
      reason: input.reason,
      ownerVerificationStatus: this.verificationStatus(current.ownerId),
      now,
    });
    this.replaceRequest(next);
    const audit = this.record(
      input.actor.id,
      `request.${input.to}`,
      "assistance_request",
      next.id,
      input.reason,
      { from: current.status, to: input.to },
      now,
    );
    return { request: this.copyRequest(next), audit };
  }

  reviewVerification(input: {
    actor: Actor;
    profileId: string;
    to: VerificationStatus;
    reason: string;
    now?: string;
  }): { verification: VerificationRecord; audit: AuditEntry } {
    assertAllowed(input.actor, "request:verify_recipient", { type: "verification", profileId: input.profileId });
    if (input.reason.trim().length < 8) {
      throw new DomainError("reason_required", "Record a reason of at least 8 characters.");
    }
    const current = this.verifications.find((item) => item.profileId === input.profileId);
    if (!current) throw new DomainError("not_found", "No verification record exists for that person.");
    const next = { ...current, status: input.to };
    this.verifications = this.verifications.map((item) => (item.profileId === input.profileId ? next : item));
    const audit = this.record(
      input.actor.id,
      `verification.${input.to}`,
      "recipient_verification",
      input.profileId,
      input.reason,
      {},
      input.now ?? new Date().toISOString(),
    );
    return { verification: { ...next }, audit };
  }

  quote(giftMinor: number): FeeQuote {
    return quoteFee({ giftMinor, rule: getChargeableFeeRule(this.feeRules), providerFeeMinor: 0 });
  }

  startContribution(input: {
    actor: Actor;
    requestId?: string;
    campaignId?: string;
    giftMinor: number;
    recognition: "public" | "anonymous";
    publicName?: string;
    idempotencyKey: string;
    now?: string;
  }): Contribution {
    assertAllowed(input.actor, "contribution:create");
    assertMinor(input.giftMinor, "Gift");
    if (input.giftMinor < 10_000) throw new DomainError("validation", "The smallest simulated gift is KES 100.");
    const targets = Number(Boolean(input.requestId)) + Number(Boolean(input.campaignId));
    if (targets !== 1) throw new DomainError("validation", "Choose one request or one campaign.");
    if (input.requestId) {
      const request = this.mustRequest(input.requestId);
      if (request.status !== "published") throw new DomainError("validation", "Contributions are open on published requests.");
      if (request.ownerId === input.actor.id) {
        throw new DomainError("forbidden", "You cannot contribute to your own request.");
      }
    }
    if (input.campaignId) {
      const campaign = this.mustCampaign(input.campaignId);
      if (campaign.status !== "active") throw new DomainError("validation", "Contributions are open on active campaigns.");
    }
    const existing = this.contributions.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (existing) {
      if (existing.giftMinor !== input.giftMinor || existing.donorId !== input.actor.id) {
        throw new DomainError("idempotency_conflict", "That idempotency key was already used.");
      }
      return { ...existing };
    }
    const quote = this.quote(input.giftMinor);
    const now = input.now ?? new Date().toISOString();
    const id = randomUUID();
    const initiated = this.provider.initiate({
      idempotencyKey: input.idempotencyKey,
      amountMinor: quote.donorPaysMinor,
      currency: "KES",
      clientReference: id,
    });
    const contribution: Contribution = {
      id,
      donorId: input.actor.id,
      requestId: input.requestId ?? null,
      campaignId: input.campaignId ?? null,
      recognition: input.recognition,
      publicName: input.recognition === "public" ? (input.publicName?.trim() || input.actor.displayName) : null,
      giftMinor: quote.giftMinor,
      collectedPlatformFeeMinor: quote.collectedPlatformFeeMinor,
      campaignBorneFeeMinor: quote.campaignBorneFeeMinor,
      providerFeeMinor: quote.providerFeeMinor,
      donorPaysMinor: quote.donorPaysMinor,
      netToCauseMinor: quote.netToCauseMinor,
      currency: "KES",
      idempotencyKey: input.idempotencyKey,
      provider: "mock",
      providerReference: initiated.init.providerReference,
      simulated: true,
      createdAt: now,
      status: "pending",
      receiptNumber: null,
    };
    this.contributions.push(contribution);
    this.record(input.actor.id, "contribution.started", "contribution", id, "Simulated contribution started. No money has moved.", {}, now);
    return { ...contribution };
  }

  /**
   * Applies a provider callback, then reads the provider's own status.
   * The reported status is not copied onto the contribution until verifyStatus agrees.
   */
  applyProviderCallback(input: CallbackInput & { now?: string }): {
    contribution: Contribution;
    duplicate: boolean;
    audit: AuditEntry;
  } {
    const contribution = this.contributions.find((item) => item.providerReference === input.providerReference);
    if (!contribution) throw new DomainError("not_found", "Unknown contribution.");
    const seen = this.events.find((event) => event.providerEventId === input.providerEventId);
    if (seen) {
      return {
        contribution: { ...contribution },
        duplicate: true,
        audit: this.record(
          "system",
          "payment.duplicate_ignored",
          "contribution",
          contribution.id,
          "Duplicate payment callback ignored.",
          { providerEventId: input.providerEventId },
          input.now ?? new Date().toISOString(),
        ),
      };
    }
    let callback;
    try {
      callback = this.provider.handleCallback(input);
    } catch (error) {
      const verified = this.provider.verifyStatus(contribution.providerReference);
      this.events.push({
        id: randomUUID(),
        contributionId: contribution.id,
        providerEventId: input.providerEventId,
        outcome: "rejected",
        verifiedStatus: verified.status,
        createdAt: input.now ?? new Date().toISOString(),
      });
      throw error;
    }
    const verified = this.provider.verifyStatus(contribution.providerReference);
    const now = input.now ?? new Date().toISOString();
    this.events.push({
      id: randomUUID(),
      contributionId: contribution.id,
      providerEventId: input.providerEventId,
      outcome: callback.duplicate ? "duplicate" : callback.accepted ? "accepted" : "rejected",
      verifiedStatus: verified.status,
      createdAt: now,
    });
    if (!callback.accepted || callback.duplicate || verified.status === contribution.status) {
      return {
        contribution: { ...contribution },
        duplicate: callback.duplicate,
        audit: this.record("system", "payment.callback", "contribution", contribution.id, callback.reason, {}, now),
      };
    }
    if (verified.status !== callback.status) {
      throw new DomainError("payment", "Refused to record a status the provider did not confirm.");
    }
    const receiptNumber = verified.status === "successful" ? this.nextReceipt() : contribution.receiptNumber;
    const next = this.replaceContribution({ ...contribution, status: verified.status, receiptNumber });
    if (verified.status === "successful") this.appendSettlementLedger(next);
    if (verified.status === "reversed") {
      const refund = this.makeRefund({
        contribution: next,
        amountMinor: next.giftMinor,
        reason: "Provider reported a reversal.",
        idempotencyKey: `reversal-${input.providerEventId}`,
        actorId: "system",
        now,
      });
      this.refunds.push(refund);
      this.appendRefundLedger(refund, next);
    }
    const audit = this.record(
      "system",
      `payment.${verified.status}`,
      "contribution",
      next.id,
      "Status recorded from the simulated provider, not from a browser redirect.",
      {},
      now,
    );
    return { contribution: { ...next }, duplicate: false, audit };
  }

  readReturn(contributionId: string, browserClaim: string | null): PaymentEventRecord["verifiedStatus"] {
    const contribution = this.mustContribution(contributionId);
    const verified = this.provider.verifyStatus(contribution.providerReference);
    return statusAfterBrowserReturn(browserClaim, verified.status);
  }

  signSimulation(input: {
    providerReference: string;
    providerEventId: string;
    reportedStatus: CallbackInput["reportedStatus"];
    amountMinor: number;
  }): string {
    return this.provider.signCallback(input);
  }

  refundContribution(input: {
    actor: Actor;
    contributionId: string;
    amountMinor: number;
    reason: string;
    idempotencyKey: string;
    now?: string;
  }): { contribution: Contribution; refund: RefundRecord; audit: AuditEntry } {
    assertAllowed(input.actor, "transaction:record_reversal");
    if (input.reason.trim().length < 8) throw new DomainError("reason_required", "Record a reason of at least 8 characters.");
    const contribution = this.mustContribution(input.contributionId);
    const already = this.refundedMinor(contribution.id);
    if (contribution.status !== "successful") {
      throw new DomainError("refund", "Only a successful simulated contribution can be refunded.");
    }
    if (already + input.amountMinor > contribution.netToCauseMinor) {
      throw new DomainError("refund", "The refund is larger than the amount recorded for the cause.");
    }
    const existing = this.refunds.find((refund) => refund.idempotencyKey === input.idempotencyKey);
    if (existing) return { contribution: { ...contribution }, refund: { ...existing }, audit: this.audit[this.audit.length - 1]! };
    const providerResult = this.provider.refund({
      providerReference: contribution.providerReference,
      amountMinor: input.amountMinor,
      idempotencyKey: input.idempotencyKey,
    });
    const now = input.now ?? new Date().toISOString();
    const refund = this.makeRefund({
      contribution,
      amountMinor: input.amountMinor,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      actorId: input.actor.id,
      now,
    });
    if (!providerResult.duplicate) {
      this.refunds.push(refund);
      this.appendRefundLedger(refund, contribution);
    }
    const next = this.replaceContribution({
      ...contribution,
      status: providerResult.status,
      receiptNumber: contribution.receiptNumber,
    });
    if (next.giftMinor !== contribution.giftMinor) {
      throw new DomainError("ledger", "A refund tried to change the original gift.");
    }
    const audit = this.record(input.actor.id, "payment.refunded", "contribution", contribution.id, input.reason, {}, now);
    return { contribution: { ...next }, refund, audit };
  }

  closeCampaign(actor: Actor, campaignId: string, reason: string, now?: string): { campaign: CampaignRecord; disbursementsCreated: 0; audit: AuditEntry } {
    const before = this.disbursements.length;
    const campaign = transitionCampaign({ campaign: this.mustCampaign(campaignId), to: "closed", actor, reason });
    this.replaceCampaign(campaign);
    const audit = this.record(actor.id, "campaign.closed", "campaign", campaign.id, reason, {}, now ?? new Date().toISOString());
    if (this.disbursements.length !== before) {
      throw new DomainError("campaign", "Closing a campaign must not create a disbursement.");
    }
    return { campaign, disbursementsCreated: 0, audit };
  }

  startReconciliation(actor: Actor, campaignId: string, reason: string, now?: string): CampaignRecord {
    const campaign = transitionCampaign({ campaign: this.mustCampaign(campaignId), to: "reconciling", actor, reason });
    this.replaceCampaign(campaign);
    this.record(actor.id, "campaign.reconciling", "campaign", campaign.id, reason, {}, now ?? new Date().toISOString());
    return { ...campaign };
  }

  approveDisbursement(input: {
    actor: Actor;
    campaignId: string;
    requestId?: string;
    beneficiaryOwnerId: string | null;
    amountMinor: number;
    reason: string;
    now?: string;
  }): { disbursement: Disbursement; audit: AuditEntry } {
    const campaign = this.mustCampaign(input.campaignId);
    assertDisbursementAllowed({
      campaign,
      amountMinor: input.amountMinor,
      actor: input.actor,
      beneficiaryOwnerId: input.beneficiaryOwnerId,
    });
    const now = input.now ?? new Date().toISOString();
    const disbursement: Disbursement = {
      id: randomUUID(),
      campaignId: campaign.id,
      requestId: input.requestId ?? null,
      beneficiaryOwnerId: input.beneficiaryOwnerId,
      amountMinor: input.amountMinor,
      currency: "KES",
      status: "approved",
      fundsSent: false,
      providerTransferReference: null,
      reason: input.reason,
      decidedBy: input.actor.id,
      createdAt: now,
    };
    this.disbursements.push(disbursement);
    this.appendDisbursementLedger(disbursement);
    const audit = this.record(input.actor.id, "disbursement.approved", "disbursement", disbursement.id, input.reason, { fundsSent: "false" }, now);
    return { disbursement: { ...disbursement }, audit };
  }

  publishReport(actor: Actor, campaignId: string, narrative: string, now?: string): { report: ReportRecord; audit: AuditEntry } {
    assertAllowed(actor, "report:publish");
    if (narrative.trim().length < 20) throw new DomainError("validation", "Write a short report of what was decided.");
    const campaign = this.mustCampaign(campaignId);
    if (campaign.status !== "reconciling") {
      throw new DomainError("report", "Publish a report after reconciliation, not at the moment of closure.");
    }
    const totals = this.totalsFor(campaignId);
    const timestamp = now ?? new Date().toISOString();
    const report: ReportRecord = {
      id: randomUUID(),
      campaignId,
      narrative: narrative.trim(),
      grossGiftMinor: totals.successfulGiftMinor,
      platformFeeMinor: totals.platformFeeCollectedMinor,
      netGiftMinor: totals.netGiftMinor,
      disbursementApprovedMinor: totals.disbursementApprovedMinor,
      currency: "KES",
      publishedAt: timestamp,
      publishedBy: actor.id,
      demo: campaign.demo,
    };
    this.reports.push(report);
    const next = transitionCampaign({ campaign, to: "reported", actor, reason: narrative });
    this.replaceCampaign(next);
    const audit = this.record(actor.id, "report.published", "report", report.id, narrative, {}, timestamp);
    return { report: { ...report }, audit };
  }

  fileComplaint(input: {
    actor: Actor | null;
    subjectType: Complaint["subjectType"];
    subjectId?: string;
    body: string;
    now?: string;
  }): Complaint {
    assertAllowed(input.actor, "complaint:submit");
    const body = input.body.trim();
    if (body.length < 20 || body.length > 2000) {
      throw new DomainError("validation", "Describe the concern in 20 to 2000 characters.");
    }
    const complaint: Complaint = {
      id: randomUUID(),
      reporterId: input.actor?.id ?? null,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      body,
      status: "open",
      createdAt: input.now ?? new Date().toISOString(),
    };
    this.complaints.push(complaint);
    return { ...complaint };
  }

  listContributionsForDonor(actor: Actor): Contribution[] {
    assertAllowed(actor, "contribution:read_own", { type: "contribution", donorId: actor.id });
    return this.contributions.filter((item) => item.donorId === actor.id).map((item) => ({ ...item }));
  }

  readContribution(actor: Actor, id: string): Contribution {
    const contribution = this.mustContribution(id);
    if (contribution.donorId === actor.id) {
      assertAllowed(actor, "contribution:read_own", { type: "contribution", donorId: contribution.donorId });
      return { ...contribution };
    }
    assertAllowed(actor, "contribution:read_any");
    return { ...contribution };
  }

  acknowledgements(requestId: string): PublicAcknowledgement[] {
    return this.contributions
      .filter((item) => item.requestId === requestId && item.status === "successful")
      .map((item) => ({
        id: item.id,
        displayName: item.recognition === "anonymous" ? "Anonymous" : (item.publicName ?? "Neighbour"),
        giftMinor: item.giftMinor,
        currency: "KES" as const,
        simulated: true as const,
      }));
  }

  totalsFor(campaignId: string): CampaignTotals {
    return campaignTotals({
      campaignId,
      contributions: this.contributions,
      refunds: this.refunds,
      disbursements: this.disbursements,
    });
  }

  listLedger(actor: Actor): readonly LedgerEntry[] {
    assertAllowed(actor, "contribution:read_any");
    return this.ledger.map((entry) => ({ ...entry }));
  }

  listAudit(actor: Actor): readonly AuditEntry[] {
    assertAllowed(actor, "audit:read");
    return this.audit.map((entry) => ({ ...entry, metadata: { ...entry.metadata } }));
  }

  listRequestAudit(actor: Actor, requestId: string): AuditEntry[] {
    const request = this.mustRequest(requestId);
    if (actor.id === request.ownerId) {
      assertAllowed(actor, "request:read_own_private", { type: "request", ownerId: request.ownerId });
    } else {
      assertAllowed(actor, "audit:read");
    }
    return this.audit
      .filter((entry) => entry.entityId === requestId)
      .map((entry) => ({ ...entry, metadata: { ...entry.metadata } }));
  }

  listReports(): ReportRecord[] {
    return this.reports.map((report) => ({ ...report }));
  }

  listDisbursements(actor: Actor): Disbursement[] {
    assertAllowed(actor, "campaign:manage");
    return this.disbursements.map((item) => ({ ...item }));
  }

  listComplaints(actor: Actor): Complaint[] {
    assertAllowed(actor, "complaint:review");
    return this.complaints.map((item) => ({ ...item }));
  }

  verificationFor(profileId: string): VerificationRecord | null {
    const record = this.verifications.find((item) => item.profileId === profileId);
    return record ? { ...record } : null;
  }

  raisedMinor(requestId: string): number {
    return this.ledger
      .filter((entry) => entry.requestId === requestId)
      .reduce((sum, entry) => {
        if (entry.effect === "increase_cause") return sum + entry.amountMinor;
        if (entry.effect === "decrease_cause") return sum - entry.amountMinor;
        return sum;
      }, 0);
  }

  causeNetFromLedger(): number {
    return this.ledger.reduce((sum, entry) => {
      if (entry.effect === "increase_cause") return sum + entry.amountMinor;
      if (entry.effect === "decrease_cause") return sum - entry.amountMinor;
      return sum;
    }, 0);
  }

  platformRevenueFromLedger(): number {
    return this.ledger.reduce((sum, entry) => {
      if (entry.effect === "increase_platform_revenue") return sum + entry.amountMinor;
      if (entry.effect === "decrease_platform_revenue") return sum - entry.amountMinor;
      return sum;
    }, 0);
  }

  private appendSettlementLedger(contribution: Contribution): void {
    const createdAt = contribution.createdAt;
    this.ledger.push({
      id: randomUUID(),
      kind: "gift",
      effect: "increase_cause",
      amountMinor: contribution.netToCauseMinor,
      currency: "KES",
      requestId: contribution.requestId,
      campaignId: contribution.campaignId,
      contributionId: contribution.id,
      disbursementId: null,
      createdAt,
      memo: "Simulated gift. No money moved.",
    });
    const fee = contribution.collectedPlatformFeeMinor + contribution.campaignBorneFeeMinor;
    if (fee > 0) {
      this.ledger.push({
        id: randomUUID(),
        kind: "platform_fee",
        effect: "increase_platform_revenue",
        amountMinor: fee,
        currency: "KES",
        requestId: contribution.requestId,
        campaignId: contribution.campaignId,
        contributionId: contribution.id,
        disbursementId: null,
        createdAt,
        memo: "Platform fee, recorded separately from the gift.",
      });
    }
    if (contribution.providerFeeMinor > 0) {
      this.ledger.push({
        id: randomUUID(),
        kind: "provider_fee",
        effect: "provider_cost",
        amountMinor: contribution.providerFeeMinor,
        currency: "KES",
        requestId: contribution.requestId,
        campaignId: contribution.campaignId,
        contributionId: contribution.id,
        disbursementId: null,
        createdAt,
        memo: "Payment provider fee. Not platform revenue.",
      });
    }
  }

  private appendRefundLedger(refund: RefundRecord, contribution: Contribution): void {
    this.ledger.push({
      id: randomUUID(),
      kind: "refund",
      effect: "decrease_cause",
      amountMinor: refund.amountMinor,
      currency: "KES",
      requestId: contribution.requestId,
      campaignId: contribution.campaignId,
      contributionId: contribution.id,
      disbursementId: null,
      createdAt: refund.createdAt,
      memo: "Simulated refund. The original gift entry is unchanged.",
    });
  }

  private appendDisbursementLedger(disbursement: Disbursement): void {
    this.ledger.push({
      id: randomUUID(),
      kind: "disbursement",
      effect: "disbursement_approved",
      amountMinor: disbursement.amountMinor,
      currency: "KES",
      requestId: disbursement.requestId,
      campaignId: disbursement.campaignId,
      contributionId: null,
      disbursementId: disbursement.id,
      createdAt: disbursement.createdAt,
      memo: "Approval recorded. No transfer was sent.",
    });
  }

  private makeRefund(input: {
    contribution: Contribution;
    amountMinor: number;
    reason: string;
    idempotencyKey: string;
    actorId: string;
    now: string;
  }): RefundRecord {
    return {
      id: randomUUID(),
      contributionId: input.contribution.id,
      amountMinor: input.amountMinor,
      currency: "KES",
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.now,
      approvedBy: input.actorId,
      simulated: true,
    };
  }

  private refundedMinor(contributionId: string): number {
    return this.refunds
      .filter((refund) => refund.contributionId === contributionId)
      .reduce((sum, refund) => sum + refund.amountMinor, 0);
  }

  private nextReceipt(): string {
    const number = `SIM-${String(this.receiptSequence).padStart(6, "0")}`;
    this.receiptSequence += 1;
    return number;
  }

  private verificationStatus(profileId: string): VerificationRecord["status"] {
    return this.verifications.find((item) => item.profileId === profileId)?.status ?? "not_started";
  }

  private record(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    reason: string,
    metadata: Record<string, string>,
    createdAt: string,
  ): AuditEntry {
    const entry: AuditEntry = {
      id: randomUUID(),
      actorId,
      action,
      entityType,
      entityId,
      reason,
      createdAt,
      metadata,
    };
    this.audit.push(entry);
    return entry;
  }

  private mustRequest(id: string): RequestRecord {
    const request = this.requests.find((item) => item.id === id);
    if (!request) throw new DomainError("not_found", "Request not found.");
    return request;
  }

  private mustCampaign(id: string): CampaignRecord {
    const campaign = this.campaigns.find((item) => item.id === id);
    if (!campaign) throw new DomainError("not_found", "Campaign not found.");
    return campaign;
  }

  private mustContribution(id: string): Contribution {
    const contribution = this.contributions.find((item) => item.id === id);
    if (!contribution) throw new DomainError("not_found", "Contribution not found.");
    return contribution;
  }

  private replaceRequest(next: RequestRecord): void {
    this.requests = this.requests.map((item) => (item.id === next.id ? next : item));
  }

  private replaceCampaign(next: CampaignRecord): void {
    this.campaigns = this.campaigns.map((item) => (item.id === next.id ? next : item));
  }

  private replaceContribution(next: Contribution): Contribution {
    this.contributions = this.contributions.map((item) => (item.id === next.id ? next : item));
    return next;
  }

  private copyRequest(request: RequestRecord): RequestRecord {
    return { ...request, flags: [...request.flags] };
  }
}

export function hashEvidence(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

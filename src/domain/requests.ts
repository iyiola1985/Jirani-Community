import { assertNever } from "@/domain/assert-never";
import { DomainError } from "@/domain/errors";
import type { Actor, RequestRecord, RequestStatus, VerificationStatus } from "@/domain/types";
import { assertAllowed } from "@/domain/permissions";

const ALLOWED: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["submitted"],
  submitted: ["under_review"],
  under_review: ["verified", "needs_information", "rejected"],
  needs_information: ["submitted"],
  verified: ["published"],
  rejected: ["under_review"],
  published: ["closed", "suspended"],
  suspended: ["under_review"],
  closed: [],
};

export function allowedRequestTransitions(from: RequestStatus): readonly RequestStatus[] {
  switch (from) {
    case "draft":
    case "submitted":
    case "under_review":
    case "needs_information":
    case "verified":
    case "rejected":
    case "published":
    case "suspended":
    case "closed":
      return ALLOWED[from];
    default:
      return assertNever(from);
  }
}

export function transitionRequest(input: {
  request: RequestRecord;
  to: RequestStatus;
  actor: Actor;
  reason: string;
  ownerVerificationStatus: VerificationStatus;
  now: string;
}): RequestRecord {
  const { request, to, actor, reason } = input;
  if (!allowedRequestTransitions(request.status).includes(to)) {
    throw new DomainError(
      "request_transition",
      `A request cannot move from ${request.status} to ${to}.`,
    );
  }

  const ownerStep = (request.status === "draft" || request.status === "needs_information") && to === "submitted";
  if (ownerStep) {
    assertAllowed(actor, "request:create", { type: "request", ownerId: request.ownerId });
    if (actor.id !== request.ownerId) {
      throw new DomainError("forbidden", "Only the recipient who owns this request can submit it.");
    }
  } else if (to === "published") {
    assertAllowed(actor, "request:publish", { type: "request", ownerId: request.ownerId });
  } else {
    assertAllowed(actor, "request:review", { type: "request", ownerId: request.ownerId });
  }

  if (!ownerStep && reason.trim().length < 8) {
    throw new DomainError("reason_required", "Record a reason of at least 8 characters.");
  }
  if (to === "verified" && input.ownerVerificationStatus !== "verified") {
    throw new DomainError(
      "verification_required",
      "Verify the recipient's identity record before verifying this request.",
    );
  }

  return { ...request, status: to };
}

export function assertPublishableSummary(summary: string): void {
  if (summary.trim().length < 40) {
    throw new DomainError("validation", "The public summary needs at least 40 characters.");
  }
}

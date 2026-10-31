import { DomainError } from "@/domain/errors";
import type { Actor } from "@/domain/types";

export type { Actor } from "@/domain/types";

export type Permission =
  | "request:create"
  | "request:read_published"
  | "request:read_own_private"
  | "request:read_any_private"
  | "evidence:upload_own"
  | "evidence:read"
  | "request:review"
  | "request:publish"
  | "request:verify_recipient"
  | "contribution:create"
  | "contribution:read_own"
  | "contribution:read_any"
  | "campaign:read_public"
  | "campaign:manage"
  | "disbursement:approve"
  | "report:publish"
  | "audit:read"
  | "complaint:submit"
  | "complaint:review"
  | "transaction:record_reversal";

export type Resource =
  | { type: "request"; ownerId: string }
  | { type: "evidence"; ownerId: string }
  | { type: "contribution"; donorId: string }
  | { type: "disbursement"; beneficiaryOwnerId: string | null }
  | { type: "verification"; profileId: string };

export type Decision = { allowed: true } | { allowed: false; reason: string };

function allow(): Decision {
  return { allowed: true };
}

function deny(reason: string): Decision {
  return { allowed: false, reason };
}

function isAdmin(actor: Actor): boolean {
  return actor.roles.includes("administrator");
}

/**
 * Server and database code both call this policy.
 * There is no permission that edits a recorded financial amount.
 */
export function authorize(
  actor: Actor | null,
  permission: Permission,
  resource?: Resource,
): Decision {
  if (
    permission === "request:read_published" ||
    permission === "campaign:read_public" ||
    permission === "complaint:submit"
  ) {
    return allow();
  }
  if (!actor) return deny("Sign in to continue.");

  switch (permission) {
    case "request:create":
    case "evidence:upload_own":
      return actor.roles.includes("recipient")
        ? allow()
        : deny("Only a recipient account can submit an assistance request.");
    case "request:read_own_private": {
      if (resource?.type !== "request") return deny("Missing request.");
      if (resource.ownerId === actor.id && actor.roles.includes("recipient")) return allow();
      return deny("You can only open your own private request.");
    }
    case "request:read_any_private":
    case "audit:read":
    case "contribution:read_any":
    case "complaint:review":
      return isAdmin(actor) ? allow() : deny("Only an administrator can open that record.");
    case "evidence:read": {
      if (resource?.type !== "evidence") return deny("Missing evidence.");
      if (resource.ownerId === actor.id && actor.roles.includes("recipient")) return allow();
      if (isAdmin(actor) && resource.ownerId === actor.id) {
        return deny("You cannot open a review file on your own request.");
      }
      if (isAdmin(actor)) return allow();
      return deny("Private evidence stays with the recipient and the reviewing administrator.");
    }
    case "request:review":
    case "request:publish":
    case "request:verify_recipient": {
      if (!isAdmin(actor)) return deny("Only an administrator can make that decision.");
      if (resource?.type === "request" && resource.ownerId === actor.id) {
        return deny("You cannot review or publish your own assistance request.");
      }
      if (resource?.type === "verification" && resource.profileId === actor.id) {
        return deny("You cannot verify your own identity record.");
      }
      return allow();
    }
    case "contribution:create":
      return actor.roles.includes("donor")
        ? allow()
        : deny("Only a donor account can record a contribution.");
    case "contribution:read_own": {
      if (resource?.type !== "contribution") return deny("Missing contribution.");
      if (resource.donorId === actor.id) return allow();
      return deny("You can only open your own contributions.");
    }
    case "campaign:manage":
    case "report:publish":
    case "transaction:record_reversal":
      return isAdmin(actor) ? allow() : deny("Only an administrator can do that.");
    case "disbursement:approve": {
      if (!isAdmin(actor)) return deny("Only an administrator can approve a disbursement.");
      if (resource?.type === "disbursement" && resource.beneficiaryOwnerId === actor.id) {
        return deny("You cannot approve a disbursement to yourself.");
      }
      return allow();
    }
    default: {
      const _exhaustive: never = permission;
      return deny(`Unknown permission ${String(_exhaustive)}.`);
    }
  }
}

export function assertAllowed(
  actor: Actor | null,
  permission: Permission,
  resource?: Resource,
): void {
  const decision = authorize(actor, permission, resource);
  if (!decision.allowed) throw new DomainError("forbidden", decision.reason);
}

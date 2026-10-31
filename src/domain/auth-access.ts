import { DomainError } from "@/domain/errors";
import { SELF_SERVICE_ROLES, type Actor, type Role, type SelfServiceRole } from "@/domain/types";

export type DashboardArea = "recipient" | "donor" | "corporate" | "administrator";

export type DashboardLink = {
  area: DashboardArea;
  href: string;
  label: string;
};

const DASHBOARDS: readonly DashboardLink[] = [
  { area: "recipient", href: "/dashboard/recipient", label: "Request help" },
  { area: "donor", href: "/dashboard/donor", label: "Give help" },
  { area: "corporate", href: "/dashboard/corporate", label: "Organisation" },
  { area: "administrator", href: "/dashboard/admin", label: "Review desk" },
];

const PROFILE_FIELDS = new Set(["displayName", "preferredLanguage", "county", "phone"]);

export function roleForNewAccount(requested: string): SelfServiceRole | null {
  if (SELF_SERVICE_ROLES.includes(requested as SelfServiceRole)) return requested as SelfServiceRole;
  return null;
}

/** Roles come from the database. Signup metadata is not an authority. */
export function rolesFromDatabase(rows: readonly { role: string }[]): Role[] {
  const roles: Role[] = [];
  for (const row of rows) {
    if (row.role === "recipient" || row.role === "donor" || row.role === "corporate_partner" || row.role === "administrator") {
      if (!roles.includes(row.role)) roles.push(row.role);
    }
  }
  return roles;
}

export function decideRoleAssignment(actor: Actor | null, targetUserId: string, role: Role): { allowed: true } | { allowed: false; reason: string } {
  if (!actor) return { allowed: false, reason: "Sign in to continue." };
  if (role === "administrator") {
    if (!actor.roles.includes("administrator")) {
      return { allowed: false, reason: "Only an administrator can assign that role." };
    }
    if (actor.id === targetUserId) {
      return { allowed: false, reason: "You cannot grant yourself administrator." };
    }
    return { allowed: true };
  }
  if (actor.id !== targetUserId && !actor.roles.includes("administrator")) {
    return { allowed: false, reason: "You cannot assign a role for another person." };
  }
  return { allowed: true };
}

export function assertRoleAssignment(actor: Actor | null, targetUserId: string, role: Role): void {
  const decision = decideRoleAssignment(actor, targetUserId, role);
  if (!decision.allowed) throw new DomainError("forbidden", decision.reason);
}

export function canReadProfile(actor: Actor | null, profileId: string): boolean {
  if (!actor) return false;
  return actor.id === profileId || actor.roles.includes("administrator");
}

export function decideProfileUpdate(
  actor: Actor | null,
  profileId: string,
  fields: readonly string[],
): { allowed: true } | { allowed: false; reason: string } {
  if (!canReadProfile(actor, profileId) || actor?.id !== profileId) {
    if (actor?.roles.includes("administrator")) {
      return { allowed: false, reason: "Administrators change account status through a separate recorded action." };
    }
    return { allowed: false, reason: "You can only edit your own profile." };
  }
  if (fields.some((field) => field === "role" || field === "accountStatus" || field === "account_status")) {
    return { allowed: false, reason: "Role and account status cannot be changed from the profile form." };
  }
  if (fields.some((field) => !PROFILE_FIELDS.has(field))) {
    return { allowed: false, reason: "That profile field cannot be edited here." };
  }
  return { allowed: true };
}

export function canReadVerificationNotes(actor: Actor | null, ownerId: string): boolean {
  if (!actor) return false;
  return actor.id === ownerId || actor.roles.includes("administrator");
}

export function canApproveVerification(actor: Actor | null, subjectId: string): boolean {
  if (!actor?.roles.includes("administrator")) return false;
  return actor.id !== subjectId;
}

export function canModifyAuditLog(): false {
  return false;
}

export function canEnterDashboard(actor: Actor | null, area: DashboardArea): boolean {
  if (!actor) return false;
  switch (area) {
    case "recipient":
      return actor.roles.includes("recipient");
    case "donor":
      return actor.roles.includes("donor");
    case "corporate":
      return actor.roles.includes("corporate_partner");
    case "administrator":
      return actor.roles.includes("administrator");
    default: {
      const _exhaustive: never = area;
      return _exhaustive;
    }
  }
}

export function accessDashboard(actor: Actor | null, area: DashboardArea): "allow" | "login" | "unauthorized" {
  if (!actor) return "login";
  return canEnterDashboard(actor, area) ? "allow" : "unauthorized";
}

export function dashboardsFor(actor: Actor): DashboardLink[] {
  return DASHBOARDS.filter((link) => canEnterDashboard(actor, link.area));
}

export function isProtectedPath(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

export function planPasswordReset(
  email: string,
  providerConfigured: boolean,
): { deliver: false; message: string } | { deliver: true; email: string; message: string } {
  const normalised = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
    return { deliver: false, message: "Enter the email address on the account." };
  }
  if (!providerConfigured) {
    return {
      deliver: false,
      message: "No reset email was sent. Supabase Auth is not configured, so there is no mailbox to send from.",
    };
  }
  return {
    deliver: true,
    email: normalised,
    message: "If that address has an account, a reset link is on its way. Check the inbox you used to register.",
  };
}

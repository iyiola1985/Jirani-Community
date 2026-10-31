import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  accessDashboard,
  canApproveVerification,
  canModifyAuditLog,
  canReadProfile,
  canReadVerificationNotes,
  dashboardsFor,
  decideProfileUpdate,
  decideRoleAssignment,
  isProtectedPath,
  planPasswordReset,
  roleForNewAccount,
  rolesFromDatabase,
} from "@/domain/auth-access";
import { planPhoneVerification } from "@/domain/phone";
import { SUPABASE_PUBLIC_ENV, SUPABASE_SERVICE_ROLE_ENV } from "@/config/supabase";
import type { Actor } from "@/domain/types";
import { validateRegistration } from "@/domain/validation";

const recipient: Actor = { id: "11111111-1111-4111-8111-111111111111", roles: ["recipient"], displayName: "Achieng" };
const donor: Actor = { id: "22222222-2222-4222-8222-222222222222", roles: ["donor"], displayName: "Wanjiku" };
const admin: Actor = { id: "33333333-3333-4333-8333-333333333333", roles: ["administrator"], displayName: "Otieno" };
const both: Actor = { id: "77777777-7777-4777-8777-777777777777", roles: ["recipient", "donor"], displayName: "Nyambura" };
const corporate: Actor = { id: "66666666-6666-4666-8666-666666666666", roles: ["corporate_partner"], displayName: "Shola Supplies" };

const validRegistration = {
  displayName: "Ada",
  email: "ada@example.com",
  password: "long-password",
  role: "donor",
  acceptedTerms: true,
};

describe("registration validation", () => {
  it("accepts a corporate partner and a Kenyan phone number", () => {
    const result = validateRegistration(
      { ...validRegistration, role: "corporate_partner", phone: "0712 345 678", county: "Kisumu" },
      ["Kisumu"],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.role).toBe("corporate_partner");
      expect(result.value.phone).toBe("+254712345678");
    }
  });

  it("rejects a short password, a bad email, and an unknown county", () => {
    const result = validateRegistration(
      { ...validRegistration, email: "ada", password: "short", county: "Not a county" },
      ["Kisumu"],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.email).toBeTruthy();
      expect(result.errors.password).toBeTruthy();
      expect(result.errors.county).toBeTruthy();
    }
  });

  it("rejects administrator and does not treat it as a self-service role", () => {
    const result = validateRegistration({ ...validRegistration, role: "administrator" });
    expect(result.ok).toBe(false);
    expect(roleForNewAccount("administrator")).toBeNull();
    expect(roleForNewAccount("corporate_partner")).toBe("corporate_partner");
  });
});

describe("password reset and phone verification", () => {
  it("does not plan an email when the provider is absent", () => {
    expect(planPasswordReset("ada@example.com", false).deliver).toBe(false);
    expect(planPasswordReset("not-an-email", true).deliver).toBe(false);
    expect(planPasswordReset("ada@example.com", true)).toMatchObject({ deliver: true, email: "ada@example.com" });
  });

  it("never claims an SMS was sent", () => {
    const result = planPhoneVerification("0712345678");
    expect(result.sent).toBe(false);
    expect(result.phone).toBe("+254712345678");
  });
});

describe("roles and protected areas", () => {
  it("routes a person with two roles to both dashboards", () => {
    expect(dashboardsFor(both).map((link) => link.area)).toEqual(["recipient", "donor"]);
    expect(accessDashboard(null, "donor")).toBe("login");
    expect(accessDashboard(donor, "administrator")).toBe("unauthorized");
    expect(accessDashboard(corporate, "corporate")).toBe("allow");
    expect(accessDashboard(corporate, "administrator")).toBe("unauthorized");
    expect(isProtectedPath("/dashboard/admin")).toBe(true);
    expect(isProtectedPath("/login")).toBe(false);
  });

  it("refuses privilege escalation", () => {
    expect(decideRoleAssignment(recipient, recipient.id, "administrator").allowed).toBe(false);
    expect(decideRoleAssignment(admin, admin.id, "administrator").allowed).toBe(false);
    expect(decideRoleAssignment(donor, recipient.id, "administrator").allowed).toBe(false);
    expect(decideRoleAssignment(admin, recipient.id, "administrator").allowed).toBe(true);
    expect(decideRoleAssignment(recipient, recipient.id, "donor").allowed).toBe(true);
  });

  it("reads roles from database rows and ignores unknown values", () => {
    expect(rolesFromDatabase([{ role: "donor" }, { role: "administrator" }, { role: "superuser" }])).toEqual([
      "donor",
      "administrator",
    ]);
  });
});

describe("private records", () => {
  it("blocks cross-user profile access and privileged profile fields", () => {
    expect(canReadProfile(null, recipient.id)).toBe(false);
    expect(canReadProfile(donor, recipient.id)).toBe(false);
    expect(canReadProfile(recipient, recipient.id)).toBe(true);
    expect(decideProfileUpdate(recipient, recipient.id, ["displayName"]).allowed).toBe(true);
    expect(decideProfileUpdate(recipient, recipient.id, ["accountStatus"]).allowed).toBe(false);
    expect(decideProfileUpdate(donor, recipient.id, ["displayName"]).allowed).toBe(false);
  });

  it("keeps verification notes private and blocks self-approval", () => {
    expect(canReadVerificationNotes(null, recipient.id)).toBe(false);
    expect(canReadVerificationNotes(donor, recipient.id)).toBe(false);
    expect(canReadVerificationNotes(recipient, recipient.id)).toBe(true);
    expect(canReadVerificationNotes(admin, recipient.id)).toBe(true);
    expect(canApproveVerification(recipient, recipient.id)).toBe(false);
    expect(canApproveVerification(admin, admin.id)).toBe(false);
    expect(canApproveVerification(admin, recipient.id)).toBe(true);
  });

  it("does not allow anyone to modify an audit log", () => {
    expect(canModifyAuditLog()).toBe(false);
  });

  it("keeps the service-role key out of the public environment list", () => {
    expect(SUPABASE_PUBLIC_ENV).not.toContain(SUPABASE_SERVICE_ROLE_ENV);
  });

  it("reserves administrator bootstrap for the database owner", () => {
    const sql = readFileSync(new URL("../db/migrations/0002_auth_roles.sql", import.meta.url), "utf8");
    expect(sql).toContain("jirani.bootstrap_administrator");
    expect(sql).toContain("REVOKE ALL ON FUNCTION jirani.bootstrap_administrator(uuid) FROM PUBLIC");
    expect(sql).not.toContain("GRANT EXECUTE ON FUNCTION jirani.bootstrap_administrator");
    expect(sql).toContain("you cannot grant yourself administrator");
    expect(sql).toContain("you cannot review your own verification");
  });
});

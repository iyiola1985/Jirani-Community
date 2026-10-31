import { describe, expect, it } from "vitest";

import { authorize, type Permission } from "@/domain/permissions";
import type { Actor } from "@/domain/types";

const recipient: Actor = { id: "11111111-1111-4111-8111-111111111111", roles: ["recipient"], displayName: "Recipient" };
const donor: Actor = { id: "22222222-2222-4222-8222-222222222222", roles: ["donor"], displayName: "Donor" };
const admin: Actor = { id: "33333333-3333-4333-8333-333333333333", roles: ["administrator"], displayName: "Admin" };
const ownerAdmin: Actor = { id: recipient.id, roles: ["recipient", "administrator"], displayName: "Owner admin" };

type NoEditPermission = Extract<Permission, "transaction:edit">;
const noSilentEdit: NoEditPermission extends never ? true : never = true;

describe("permissions", () => {
  it("keeps financial edits out of the permission list", () => {
    expect(noSilentEdit).toBe(true);
  });

  it("lets a recipient submit and blocks them from publishing", () => {
    expect(authorize(recipient, "request:create").allowed).toBe(true);
    expect(authorize(recipient, "request:publish", { type: "request", ownerId: "someone-else" }).allowed).toBe(false);
  });

  it("stops an administrator from reviewing their own request", () => {
    const decision = authorize(ownerAdmin, "request:publish", { type: "request", ownerId: ownerAdmin.id });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/own assistance request/);
  });

  it("stops a donor from opening private evidence", () => {
    const decision = authorize(donor, "evidence:read", { type: "evidence", ownerId: recipient.id });
    expect(decision.allowed).toBe(false);
  });

  it("lets the owner and a different administrator open evidence", () => {
    expect(authorize(recipient, "evidence:read", { type: "evidence", ownerId: recipient.id }).allowed).toBe(true);
    expect(authorize(admin, "evidence:read", { type: "evidence", ownerId: recipient.id }).allowed).toBe(true);
  });

  it("stops a person from approving a disbursement to themselves", () => {
    const decision = authorize(admin, "disbursement:approve", {
      type: "disbursement",
      beneficiaryOwnerId: admin.id,
    });
    expect(decision.allowed).toBe(false);
  });

  it("requires a donor role to contribute and an admin role to refund", () => {
    expect(authorize(donor, "contribution:create").allowed).toBe(true);
    expect(authorize(recipient, "contribution:create").allowed).toBe(false);
    expect(authorize(donor, "transaction:record_reversal").allowed).toBe(false);
    expect(authorize(admin, "transaction:record_reversal").allowed).toBe(true);
  });

  it("allows anonymous visitors to read published requests and file a complaint", () => {
    expect(authorize(null, "request:read_published").allowed).toBe(true);
    expect(authorize(null, "complaint:submit").allowed).toBe(true);
    expect(authorize(null, "request:read_any_private").allowed).toBe(false);
  });
});

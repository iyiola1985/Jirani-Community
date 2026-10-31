import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/server/passwords";

describe("password hashes", () => {
  it("stores a scrypt hash and rejects a different password", async () => {
    const stored = await hashPassword("long-password");
    expect(stored.startsWith("scrypt:")).toBe(true);
    expect(stored).not.toContain("long-password");
    expect(await verifyPassword("long-password", stored)).toBe(true);
    expect(await verifyPassword("other-password", stored)).toBe(false);
  });
});

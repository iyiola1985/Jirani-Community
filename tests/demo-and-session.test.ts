import { afterEach, describe, expect, it, vi } from "vitest";

import { isDemoMode } from "@/config/brand";
import { AssistanceBook } from "@/domain/book";
import { openSession, sealSession } from "@/domain/session-token";
import { demoSeed, DEMO_DONOR_ID, DEMO_PRIVATE_PHONE, DEMO_SCHOOL_REQUEST_ID } from "@/data/demo";
import { validateRegistration, validateRequestForm } from "@/domain/validation";
import { COUNTIES } from "@/data/counties";
import { authenticateDemo, findDemoActor } from "@/server/accounts";

describe("demonstration data and sessions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps private demonstration details off the public list", () => {
    const ledger = AssistanceBook.fromSeed(demoSeed(), "test-provider-secret");
    const published = JSON.stringify(ledger.listPublishedRequests());
    expect(published).toContain("demonstration");
    expect(published).not.toContain(DEMO_PRIVATE_PHONE.replaceAll(" ", ""));
    expect(published).not.toContain("demo-bill.pdf");
    expect(published).not.toContain("Demo Recipient");
    const school = ledger.getPublicRequest(DEMO_SCHOOL_REQUEST_ID);
    expect(school?.demo).toBe(true);
    expect(school?.raisedMinor).toBe(600_000);
    expect(ledger.totalsFor("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3").platformRevenueMinor).toBe(0);
  });

  it("rejects self-assigned administrator registration", () => {
    const result = validateRegistration({
      displayName: "Ada",
      email: "ada@example.com",
      password: "long-password",
      role: "administrator",
      acceptedTerms: true,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects public text that contains a phone number", () => {
    const result = validateRequestForm(
      {
        category: "rent",
        title: "Call 0712345678 today",
        summary: "This summary is long enough to pass the length check and still includes a phone number 0712345678 for the editor.",
        county: "Nairobi",
        amountShillings: "500",
        publicAlias: "Neighbour",
        privateNotes: "",
        acceptedPublication: true,
      },
      COUNTIES,
    );
    expect(result.ok).toBe(false);
  });

  it("signs demonstration accounts in and treats a bad password as logged out", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DEMO_MODE", "true");
    const corporate = authenticateDemo("corporate@demo.jirani.test", "demo-corporate");
    const both = authenticateDemo("both@demo.jirani.test", "demo-both");
    expect(corporate?.roles).toEqual(["corporate_partner"]);
    expect(both?.roles).toEqual(["recipient", "donor"]);
    expect(authenticateDemo("both@demo.jirani.test", "not-the-password")).toBeNull();
    expect(findDemoActor("66666666-6666-4666-8666-666666666666")?.displayName).toContain("demonstration");
    expect(findDemoActor("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("refuses demonstration accounts in production and when demo mode is not exactly true", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    expect(isDemoMode()).toBe(false);
    expect(authenticateDemo("donor@demo.jirani.test", "demo-donor")).toBeNull();
    expect(findDemoActor(DEMO_DONOR_ID)).toBeNull();

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEMO_MODE", "");
    expect(isDemoMode()).toBe(false);
    expect(authenticateDemo("donor@demo.jirani.test", "demo-donor")).toBeNull();
    vi.stubEnv("DEMO_MODE", "yes");
    expect(isDemoMode()).toBe(false);
    vi.stubEnv("DEMO_MODE", "false");
    expect(isDemoMode()).toBe(false);
  });

  it("seals a session that fails when the secret or expiry changes", async () => {
    const token = await sealSession({ profileId: "11111111-1111-4111-8111-111111111111", exp: 2_000_000_000 }, "a-secret-that-is-long-enough");
    expect(await openSession(token, "a-secret-that-is-long-enough", 1_900_000_000)).not.toBeNull();
    expect(await openSession(token, "another-secret-that-is-long", 1_900_000_000)).toBeNull();
    expect(await openSession(token, "a-secret-that-is-long-enough", 2_100_000_000)).toBeNull();
  });
});

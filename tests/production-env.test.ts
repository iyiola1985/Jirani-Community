import { describe, expect, it } from "vitest";

import {
  assertProductionEnvironment,
  mockProviderSecretProblem,
  productionEnvironmentErrors,
  publicSiteUrlProblem,
  sessionSecretProblem,
  type ProductionEnv,
} from "@/config/production-env";

const ready: ProductionEnv = {
  DEMO_MODE: "false",
  DATABASE_URL: "postgresql://jirani_app:db-password-should-not-leak@db.internal:5432/jirani",
  SESSION_SECRET: "session-secret-value-that-is-32-characters",
  MOCK_PROVIDER_SECRET: "mock-provider-secret",
  NEXT_PUBLIC_SITE_URL: "https://staging.jirani.app",
};

describe("production environment", () => {
  it("accepts a complete production configuration without repeating secret values", () => {
    expect(productionEnvironmentErrors(ready)).toEqual([]);
    expect(() => assertProductionEnvironment(ready)).not.toThrow();
  });

  it("rejects an unset demo mode, a weak secret, and a non-public site URL", () => {
    const errors = productionEnvironmentErrors({
      ...ready,
      DEMO_MODE: undefined,
      SESSION_SECRET: "short-secret",
      MOCK_PROVIDER_SECRET: "dev-only-mock-provider-secret",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      DATABASE_URL: undefined,
    });
    const text = errors.join(" ");
    expect(text).toContain("DEMO_MODE must be false");
    expect(text).toContain("DATABASE_URL is required");
    expect(text).toContain("SESSION_SECRET");
    expect(text).toContain("MOCK_PROVIDER_SECRET");
    expect(text).toContain("https");
    expect(text).not.toContain("short-secret");
    expect(text).not.toContain("db-password-should-not-leak");
    expect(text).not.toContain("dev-only-mock-provider-secret");
  });

  it("rejects a site URL that is not a public https origin", () => {
    expect(publicSiteUrlProblem("https://user:password@staging.jirani.app")).toContain("username");
    expect(publicSiteUrlProblem("https://192.168.1.20")).toContain("public");
    expect(publicSiteUrlProblem("https://staging.jirani.app/login")).toContain("origin");
    expect(publicSiteUrlProblem("https://staging.jirani.app")).toBeNull();
    expect(sessionSecretProblem("dev-only-jirani-session-secret-change-me")).toContain("SESSION_SECRET");
    expect(mockProviderSecretProblem("mock-provider-secret")).toBeNull();
  });
});

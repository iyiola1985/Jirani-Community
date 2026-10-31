import { mockProviderSecretProblem, sessionSecretProblem } from "@/config/production-env";

const DEV_SESSION_SECRET = "dev-only-jirani-session-secret-change-me";
const DEV_MOCK_PROVIDER_SECRET = "dev-only-mock-provider-secret";

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    const problem = sessionSecretProblem(secret);
    if (problem || !secret) throw new Error(problem ?? "SESSION_SECRET must be a unique value of at least 32 characters.");
    return secret;
  }
  if (secret && secret.length >= 32 && secret !== DEV_SESSION_SECRET) return secret;
  return DEV_SESSION_SECRET;
}

export function getMockProviderSecret(): string {
  const secret = process.env.MOCK_PROVIDER_SECRET;
  if (process.env.NODE_ENV === "production") {
    const problem = mockProviderSecretProblem(secret);
    if (problem || !secret) throw new Error(problem ?? "MOCK_PROVIDER_SECRET must be a unique value of at least 16 characters.");
    return secret;
  }
  if (secret && secret.length >= 16 && secret !== DEV_MOCK_PROVIDER_SECRET) return secret;
  return DEV_MOCK_PROVIDER_SECRET;
}

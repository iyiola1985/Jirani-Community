const DEV_SESSION_SECRET = "dev-only-jirani-session-secret-change-me";
const DEV_MOCK_PROVIDER_SECRET = "dev-only-mock-provider-secret";

export type ProductionEnv = {
  DEMO_MODE?: string;
  DATABASE_URL?: string;
  SESSION_SECRET?: string;
  MOCK_PROVIDER_SECRET?: string;
  NEXT_PUBLIC_SITE_URL?: string;
};

export function productionEnvironmentErrors(env: ProductionEnv): string[] {
  return [
    demoModeProblem(env.DEMO_MODE),
    databaseUrlProblem(env.DATABASE_URL),
    sessionSecretProblem(env.SESSION_SECRET),
    mockProviderSecretProblem(env.MOCK_PROVIDER_SECRET),
    publicSiteUrlProblem(env.NEXT_PUBLIC_SITE_URL),
  ].filter((problem): problem is string => problem !== null);
}

export function assertProductionEnvironment(env: ProductionEnv): void {
  const errors = productionEnvironmentErrors(env);
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }
}

export function sessionSecretProblem(value: string | undefined): string | null {
  if (!value || value.length < 32 || value === DEV_SESSION_SECRET) {
    return "SESSION_SECRET must be a unique value of at least 32 characters.";
  }
  return null;
}

export function mockProviderSecretProblem(value: string | undefined): string | null {
  if (!value || value.length < 16 || value === DEV_MOCK_PROVIDER_SECRET) {
    return "MOCK_PROVIDER_SECRET must be a unique value of at least 16 characters.";
  }
  return null;
}

export function publicSiteUrlProblem(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "NEXT_PUBLIC_SITE_URL must be a public https origin.";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "NEXT_PUBLIC_SITE_URL must be a public https origin.";
  }
  if (url.username || url.password) return "NEXT_PUBLIC_SITE_URL must not include a username or password.";
  if (url.protocol !== "https:") return "NEXT_PUBLIC_SITE_URL must use https.";
  if (url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    return "NEXT_PUBLIC_SITE_URL must be an origin, without a path, query, or hash.";
  }
  if (isBlockedSiteHost(url.hostname)) return "NEXT_PUBLIC_SITE_URL must be a public hostname.";
  return null;
}

function demoModeProblem(value: string | undefined): string | null {
  if (value !== "false") return "DEMO_MODE must be false in production.";
  return null;
}

function databaseUrlProblem(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "DATABASE_URL is required in production.";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "DATABASE_URL must be a PostgreSQL connection string.";
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return "DATABASE_URL must be a PostgreSQL connection string.";
  }
  if (!url.hostname) return "DATABASE_URL must be a PostgreSQL connection string.";
  return null;
}

function isBlockedSiteHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true;
  if (host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".test") || host.endsWith(".invalid")) return true;
  if (host === "example.com" || host === "example.org" || host === "example.net" || host.endsWith(".example") || host.endsWith(".example.net")) return true;
  if (/^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(host)) return true;
  if (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(host)) return true;
  return false;
}

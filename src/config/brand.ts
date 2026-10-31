export const brand = {
  name: "Jirani",
  tagline: "Help is closer than you think.",
  description:
    "A community assistance platform for Kenya. People request verified help, and donors contribute with a clear record of every shilling.",
  legalEntity: "Shola Tech Ltd",
  supportEmail: "hello@jirani.example",
  currency: "KES" as const,
  policyVersion: "draft-2026-10",
};

/** Demonstration accounts exist only outside production, and only when DEMO_MODE is exactly "true". */
export function isDemoMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.DEMO_MODE === "true";
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

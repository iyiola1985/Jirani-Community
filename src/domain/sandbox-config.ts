import { acceptsPublicDarajaCallbackUrl } from "@/domain/daraja-stk";

export type SandboxConfig =
  | { mode: "unconfigured"; missing: readonly string[] }
  | { mode: "mock"; webhookSecret: string }
  | { mode: "daraja"; ready: false; missing: readonly string[]; verification: "incomplete"; transactionStatus: "disabled" };

const DARAJA_FIELDS = [
  "DARAJA_SANDBOX_CONSUMER_KEY",
  "DARAJA_SANDBOX_CONSUMER_SECRET",
  "DARAJA_SANDBOX_PASSKEY",
  "DARAJA_SANDBOX_SHORTCODE",
  "DARAJA_SANDBOX_CALLBACK_URL",
] as const;

export type SandboxEnv = Partial<Record<(typeof DARAJA_FIELDS)[number] | "SANDBOX_PROVIDER" | "SANDBOX_WEBHOOK_SECRET", string | undefined>>;

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Decides whether a sandbox provider can be called.
 * Daraja credentials do not enable it. A public HTTPS callback is required,
 * and neither the STK query nor Transaction Status is allowed to post a gift.
 */
export function classifySandboxConfig(env: SandboxEnv): SandboxConfig {
  const provider = env.SANDBOX_PROVIDER?.trim().toLowerCase() ?? "";
  if (provider === "" || provider === "off") {
    return { mode: "unconfigured", missing: ["SANDBOX_PROVIDER"] };
  }
  if (provider === "mock") {
    const secret = env.SANDBOX_WEBHOOK_SECRET?.trim() ?? "";
    if (secret.length < 16) return { mode: "unconfigured", missing: ["SANDBOX_WEBHOOK_SECRET"] };
    return { mode: "mock", webhookSecret: secret };
  }
  if (provider === "daraja") {
    const missing = DARAJA_FIELDS.filter((name) => !present(env[name]));
    const shortcode = env.DARAJA_SANDBOX_SHORTCODE?.trim() ?? "";
    const callback = env.DARAJA_SANDBOX_CALLBACK_URL?.trim() ?? "";
    if (shortcode && !/^[0-9]{5,7}$/.test(shortcode)) missing.push("DARAJA_SANDBOX_SHORTCODE");
    if (!acceptsPublicDarajaCallbackUrl(callback)) missing.push("DARAJA_SANDBOX_CALLBACK_URL");
    return { mode: "daraja", ready: false, missing: [...new Set(missing)], verification: "incomplete", transactionStatus: "disabled" };
  }
  return { mode: "unconfigured", missing: ["SANDBOX_PROVIDER"] };
}

import { afterEach, describe, expect, it } from "vitest";

import { accountClosePhraseMatches, replacementPasswordError } from "@/domain/account-close";
import { isSupabaseConfigured, publicSupabaseConfig } from "@/config/supabase";

const previous = {
  store: process.env.ACCOUNT_STORE,
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

afterEach(() => {
  restore("ACCOUNT_STORE", previous.store);
  restore("NEXT_PUBLIC_SUPABASE_URL", previous.url);
  restore("NEXT_PUBLIC_SUPABASE_ANON_KEY", previous.key);
});

function restore(name: "ACCOUNT_STORE" | "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("account closure", () => {
  it("accepts the confirmation phrase without extra words", () => {
    expect(accountClosePhraseMatches("  Delete My Account  ")).toBe(true);
    expect(accountClosePhraseMatches("delete")).toBe(false);
  });

  it("rejects a short, mismatched, or unchanged password", () => {
    expect(replacementPasswordError("old-password", "short", "short")).toMatch(/10 characters/);
    expect(replacementPasswordError("old-password", "new-password", "other-password")).toMatch(/same way twice/);
    expect(replacementPasswordError("old-password", "old-password", "old-password")).toMatch(/different/);
    expect(replacementPasswordError("old-password", "new-password", "new-password")).toBeNull();
  });

  it("keeps Supabase Auth off unless ACCOUNT_STORE is supabase", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    delete process.env.ACCOUNT_STORE;
    expect(publicSupabaseConfig()).not.toBeNull();
    expect(isSupabaseConfigured()).toBe(false);
    process.env.ACCOUNT_STORE = "database";
    expect(isSupabaseConfigured()).toBe(false);
    process.env.ACCOUNT_STORE = "supabase";
    expect(isSupabaseConfigured()).toBe(true);
  });
});

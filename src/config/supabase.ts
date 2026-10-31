export const SUPABASE_PUBLIC_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
export const SUPABASE_SERVICE_ROLE_ENV = "SUPABASE_SERVICE_ROLE_KEY";

export type PublicSupabaseConfig = {
  url: string;
  anonKey: string;
};

export function publicSupabaseConfig(): PublicSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** Supabase Auth is used only when this is exactly "supabase". A database URL alone keeps passwords in Postgres. */
export function usesSupabaseAuth(): boolean {
  return process.env.ACCOUNT_STORE === "supabase" && publicSupabaseConfig() !== null;
}

export function isSupabaseConfigured(): boolean {
  return usesSupabaseAuth();
}

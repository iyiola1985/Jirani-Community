import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { publicSupabaseConfig, SUPABASE_SERVICE_ROLE_ENV, usesSupabaseAuth } from "@/config/supabase";

export async function createSupabaseServerClient() {
  const config = usesSupabaseAuth() ? publicSupabaseConfig() : null;
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot always write cookies. The proxy refreshes them.
        }
      },
    },
  });
}

export function serviceRoleKey(): string | null {
  const key = process.env[SUPABASE_SERVICE_ROLE_ENV];
  return key && key.length > 0 ? key : null;
}

export function createSupabaseAdminClient() {
  const config = usesSupabaseAuth() ? publicSupabaseConfig() : null;
  const key = serviceRoleKey();
  if (!config || !key) return null;
  return createClient(config.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

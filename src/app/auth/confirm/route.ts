import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { publicSupabaseConfig, usesSupabaseAuth } from "@/config/supabase";

function emailOtpType(value: string | null): EmailOtpType | null {
  switch (value) {
    case "signup":
    case "invite":
    case "magiclink":
    case "recovery":
    case "email_change":
    case "email":
      return value;
    default:
      return null;
  }
}

export async function GET(request: NextRequest) {
  const config = usesSupabaseAuth() ? publicSupabaseConfig() : null;
  const url = new URL(request.url);
  const failed = new URL("/login", url.origin);
  failed.searchParams.set("notice", "confirm-failed");
  if (!config) {
    failed.searchParams.set("notice", "unconfigured");
    return NextResponse.redirect(failed);
  }

  const type = emailOtpType(url.searchParams.get("type"));
  const nextPath = type === "recovery" ? "/auth/update-password" : "/auth/verified";
  const destination = NextResponse.redirect(new URL(nextPath, url.origin));
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          destination.cookies.set(name, value, options);
        }
      },
    },
  });

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(failed);
    return destination;
  }
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return NextResponse.redirect(failed);
    return destination;
  }
  return NextResponse.redirect(failed);
}

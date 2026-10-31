import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { publicSupabaseConfig, usesSupabaseAuth } from "@/config/supabase";
import { getSessionSecret } from "@/config/secrets";
import { openSession, SESSION_COOKIE } from "@/domain/session-token";

export async function proxy(request: NextRequest) {
  const config = usesSupabaseAuth() ? publicSupabaseConfig() : null;
  const response = NextResponse.next({ request });
  if (config) {
    const supabase = createServerClient(config.url, config.anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    if (data.user) return response;
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await openSession(token, getSessionSecret()) : null;
  if (session) return response;
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};

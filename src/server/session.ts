import "server-only";

import { cookies } from "next/headers";
import { connection } from "next/server";

import { getSessionSecret } from "@/config/secrets";
import { rolesFromDatabase } from "@/domain/auth-access";
import { openSession, sealSession, SESSION_COOKIE } from "@/domain/session-token";
import type { Actor } from "@/domain/types";
import { findDemoActor } from "@/server/accounts";
import { findLocalActor } from "@/server/directory";
import { createSupabaseServerClient } from "@/server/supabase";

const WEEK_SECONDS = 60 * 60 * 24 * 7;

export async function getActor(): Promise<Actor | null> {
  await connection();
  const supabaseActor = await actorFromSupabase();
  if (supabaseActor) return supabaseActor;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await openSession(token, getSessionSecret());
  if (!claims) return null;
  return findDemoActor(claims.profileId) ?? findLocalActor(claims.profileId);
}

async function actorFromSupabase(): Promise<Actor | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: roleRows, error: roleError } = await supabase.from("user_roles").select("role").eq("profile_id", data.user.id);
  const roles = roleError ? [] : rolesFromDatabase(roleRows ?? []);
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, public_display_name")
    .eq("id", data.user.id)
    .maybeSingle();
  const displayName =
    (typeof profile?.display_name === "string" && profile.display_name) ||
    (typeof profile?.public_display_name === "string" && profile.public_display_name) ||
    data.user.email ||
    "Account";
  return { id: data.user.id, roles, displayName };
}

export async function startSession(actor: Actor): Promise<void> {
  const token = await sealSession(
    { profileId: actor.id, exp: Math.floor(Date.now() / 1000) + WEEK_SECONDS },
    getSessionSecret(),
  );
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WEEK_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

import "server-only";

import type { Actor } from "@/domain/types";
import { isPrivateStorageKey } from "@/domain/evidence";
import { hashPassword } from "@/server/passwords";
import { withActor } from "@/server/db-actor";
import { removePrivateEvidence } from "@/server/evidence-files";

export async function readSessionPasswordHash(actor: Actor): Promise<string | null> {
  return withActor(actor, async (client) => {
    const result = await client.query<{ password_hash: string | null }>(
      "SELECT jirani.password_hash_for_session($1) AS password_hash",
      [actor.id],
    );
    return result.rows[0]?.password_hash ?? null;
  });
}

export async function replaceStoredPassword(actor: Actor, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await withActor(actor, async (client) => {
    await client.query("SELECT jirani.replace_password($1, $2)", [actor.id, passwordHash]);
  });
}

export async function closeStoredAccount(actor: Actor): Promise<void> {
  const keys = await withActor(actor, async (client) => {
    const result = await client.query<{ keys: string[] | null }>("SELECT jirani.close_account($1) AS keys", [actor.id]);
    return result.rows[0]?.keys ?? [];
  });
  for (const key of keys) {
    if (!isPrivateStorageKey(key)) continue;
    await removePrivateEvidence(key).catch(() => undefined);
  }
}

export function accountLifecycleMessage(error: unknown, action: "close" | "password"): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("last administrator")) {
    return "The last administrator account stays open so the review desk is not locked.";
  }
  if (message.includes("already closed")) return "This account is already closed.";
  if (message.includes("only the signed-in account")) return "Sign in again, then try once more.";
  if (message.includes("no database password") || message.includes("cannot change its password")) {
    return "This sign-in has no database password to change.";
  }
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "42883" || code === "42703" || message.includes("password_hash_for_session") || message.includes("close_account")) {
    return "This needs the latest database migration. Apply it as the database owner, then try again.";
  }
  console.error(action === "close" ? "account close failed" : "password change failed");
  return action === "close"
    ? "The account could not be closed. Nothing was removed."
    : "The password could not be changed.";
}

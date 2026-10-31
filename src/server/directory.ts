import "server-only";

import { randomUUID } from "node:crypto";

import { brand } from "@/config/brand";
import { rolesFromDatabase } from "@/domain/auth-access";
import type { Actor, SelfServiceRole } from "@/domain/types";
import { hashPassword, verifyPassword } from "@/server/passwords";
import { getPool } from "@/server/pool";

export type AccountWriteResult =
  | { status: "created"; actor: Actor }
  | { status: "duplicate" }
  | { status: "unavailable" };

export type AccountLoginResult =
  | { status: "ok"; actor: Actor }
  | { status: "invalid" }
  | { status: "unavailable" };

type LoginRow = {
  profile_id: string;
  display_name: string;
  password_hash: string;
  roles: string[] | null;
};

type SessionRow = {
  profile_id: string;
  display_name: string;
  roles: string[] | null;
};

function actorFrom(id: string, displayName: string, roles: string[] | null): Actor {
  return {
    id,
    displayName,
    roles: rolesFromDatabase((roles ?? []).map((role) => ({ role }))),
  };
}

export async function registerLocalAccount(input: {
  displayName: string;
  email: string;
  password: string;
  role: SelfServiceRole;
  phone: string | null;
  county: string | null;
}): Promise<AccountWriteResult> {
  const pool = getPool();
  if (!pool) return { status: "unavailable" };
  const id = randomUUID();
  const passwordHash = await hashPassword(input.password);
  try {
    await pool.query(
      "SELECT jirani.register_account($1, $2, $3, $4, $5, $6::user_role, $7, $8)",
      [id, input.displayName, input.email, input.phone ?? "", input.county ?? "", input.role, passwordHash, brand.policyVersion],
    );
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "duplicate" };
    return { status: "unavailable" };
  }
  return {
    status: "created",
    actor: { id, displayName: input.displayName, roles: [input.role] },
  };
}

export async function authenticateLocal(email: string, password: string): Promise<AccountLoginResult> {
  const pool = getPool();
  if (!pool) return { status: "unavailable" };
  let rows: LoginRow[];
  try {
    const result = await pool.query<LoginRow>("SELECT * FROM jirani.account_for_login($1)", [email.trim().toLowerCase()]);
    rows = result.rows;
  } catch {
    return { status: "unavailable" };
  }
  const row = rows[0];
  if (!row) return { status: "invalid" };
  const matches = await verifyPassword(password, row.password_hash);
  if (!matches) return { status: "invalid" };
  return { status: "ok", actor: actorFrom(row.profile_id, row.display_name, row.roles) };
}

export async function findLocalActor(profileId: string): Promise<Actor | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const result = await pool.query<SessionRow>("SELECT * FROM jirani.account_for_session($1)", [profileId]);
    const row = result.rows[0];
    if (!row) return null;
    return actorFrom(row.profile_id, row.display_name, row.roles);
  } catch {
    return null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

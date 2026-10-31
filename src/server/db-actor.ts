import "server-only";

import type { PoolClient } from "pg";

import type { Actor } from "@/domain/types";
import { getPool } from "@/server/pool";

export async function withActor<T>(actor: Actor, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('jirani.profile_id', $1, true)", [actor.id]);
    await client.query("SELECT set_config('jirani.roles', $1, true)", [actor.roles.join(",")]);
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withDatabase<T>(run: (client: PoolClient) => Promise<T>): Promise<T | null> {
  const pool = getPool();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

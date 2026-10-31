import "server-only";

import pg from "pg";

const globalPool = globalThis as { jiraniPool?: pg.Pool };

export function getPool(): pg.Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!globalPool.jiraniPool) {
    globalPool.jiraniPool = new pg.Pool({ connectionString, max: 5 });
  }
  return globalPool.jiraniPool;
}

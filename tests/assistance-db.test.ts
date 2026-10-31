import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

function databaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const match = readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.+)$/m);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const url = databaseUrl();
const describeLive = url ? describe : describe.skip;

describeLive("assistance requests in postgres", () => {
  const client = new pg.Client({ connectionString: url });

  afterAll(async () => {
    await client.end();
  });

  it("keeps a draft private, blocks self-publication, and records history", async () => {
    await client.connect();
    const owner = randomUUID();
    const other = randomUUID();
    const hash = "scrypt:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT jirani.register_account($1, 'Amina Applicant', $2, '', 'Kisumu', 'recipient', $3, 'draft-2026-10')`,
        [owner, `amina.${owner}@example.com`, hash],
      );
      await client.query(
        `SELECT jirani.register_account($1, 'Otieno Neighbour', $2, '', 'Nairobi', 'donor', $3, 'draft-2026-10')`,
        [other, `otieno.${other}@example.com`, hash],
      );
      await client.query("SELECT set_config('jirani.trusted_role_write', 'off', true)");
      await client.query("SELECT set_config('jirani.profile_id', $1, true)", [owner]);
      await client.query("SELECT set_config('jirani.roles', 'recipient', true)");
      const inserted = await client.query(
        `INSERT INTO assistance_requests (
           recipient_profile_id, public_alias, category, title, public_summary, county, amount_needed_minor, status
         ) VALUES (
           $1, 'Neighbour in Kisumu', 'food', 'Food for a household',
           'Help with a basic food shop for a household in Kisumu County. The public text names the county only.',
           'Kisumu', 150000, 'draft'
         ) RETURNING id`,
        [owner],
      );
      const requestId = inserted.rows[0].id as string;
      await client.query("SELECT set_config('jirani.profile_id', $1, true)", [other]);
      await client.query("SELECT set_config('jirani.roles', 'donor', true)");
      const hidden = await client.query("SELECT id FROM assistance_requests WHERE id = $1", [requestId]);
      expect(hidden.rowCount).toBe(0);
      await client.query("SELECT set_config('jirani.profile_id', '', true)");
      await client.query("SELECT set_config('jirani.roles', '', true)");
      const anonymous = await client.query("SELECT id FROM assistance_requests WHERE id = $1", [requestId]);
      expect(anonymous.rowCount).toBe(0);
      await client.query("SELECT set_config('jirani.profile_id', $1, true)", [owner]);
      await client.query("SELECT set_config('jirani.roles', 'recipient', true)");
      await client.query("SAVEPOINT owner_publish");
      await expect(
        client.query("UPDATE assistance_requests SET status = 'published' WHERE id = $1", [requestId]),
      ).rejects.toThrow(/administrator/i);
      await client.query("ROLLBACK TO SAVEPOINT owner_publish");
      await client.query("SELECT set_config('jirani.profile_id', $1, true)", [owner]);
      await client.query("SELECT set_config('jirani.roles', 'recipient', true)");
      await client.query("SELECT set_config('jirani.status_reason', 'Submitted by the applicant.', true)");
      await client.query("UPDATE assistance_requests SET status = 'submitted' WHERE id = $1", [requestId]);
      const history = await client.query("SELECT to_status FROM request_status_events WHERE request_id = $1 ORDER BY created_at, ctid", [requestId]);
      expect(history.rows.map((row) => row.to_status)).toEqual(["draft", "submitted"]);
      await client.query("SAVEPOINT repeat_transition");
      await expect(
        client.query("UPDATE assistance_requests SET status = 'under_review' WHERE id = $1", [requestId]),
      ).rejects.toThrow(/administrator/i);
      await client.query("ROLLBACK TO SAVEPOINT repeat_transition");
    } finally {
      await client.query("ROLLBACK");
    }
  });
});

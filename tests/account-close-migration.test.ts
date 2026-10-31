import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

function ownerUrl(appUrl: string): string {
  const parsed = new URL(appUrl);
  parsed.username = "suddenlly";
  parsed.password = "";
  return parsed.toString().replace("suddenlly:@", "suddenlly@");
}

async function expectFailure(client: pg.Client, sql: string, values: unknown[], pattern: RegExp) {
  await client.query("SAVEPOINT attempt");
  await expect(client.query(sql, values)).rejects.toThrow(pattern);
  await client.query("ROLLBACK TO SAVEPOINT attempt");
}

describe("account close migration", () => {
  it("removes personal fields, keeps the gift, and rolls back", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const client = new pg.Client({
      connectionString: databaseUrl ? ownerUrl(databaseUrl) : "postgresql://suddenlly@localhost:5432/jirani",
    });
    try {
      await client.connect();
    } catch {
      throw new Error("The account close migration test could not open a database connection.");
    }
    const holder = randomUUID();
    const keeper = randomUUID();
    const requestId = randomUUID();
    const contributionId = randomUUID();
    const storageKey = `${randomUUID()}.pdf`;
    const hash = `scrypt:${"ab".repeat(16)}:${"cd".repeat(32)}`;
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(new URL("../db/migrations/0014_account_close.sql", import.meta.url), "utf8"));
      await client.query(`SELECT set_config('jirani.trusted_role_write', 'on', true)`);
      await client.query(
        `INSERT INTO profiles (id, public_display_name, display_name, email, phone, county) VALUES
           ($1, 'Account holder', 'Account holder', $2, '0712345678', 'Kisumu'),
           ($3, 'Review keeper', 'Review keeper', $4, NULL, NULL)`,
        [holder, `${holder}@close.test`, keeper, `${keeper}@close.test`],
      );
      await client.query(
        `INSERT INTO user_roles (profile_id, role) VALUES ($1, 'recipient'), ($1, 'donor'), ($2, 'administrator')`,
        [holder, keeper],
      );
      await client.query(`INSERT INTO auth_credentials (profile_id, password_hash) VALUES ($1, $2)`, [holder, hash]);
      await client.query(`SELECT set_config('jirani.profile_id', $1, true)`, [holder]);
      await client.query(`SELECT set_config('jirani.roles', 'recipient,donor', true)`);
      await client.query(
        `INSERT INTO assistance_requests (
           id, recipient_profile_id, public_alias, category, title, public_summary, county, amount_needed_minor, status
         ) VALUES (
           $1, $2, 'Neighbour', 'food', 'Food for a closing test',
           'This is a rollback-only application used to test account closure.',
           'Nairobi', 100000, 'draft'
         )`,
        [requestId, holder],
      );
      await client.query(
        `INSERT INTO assistance_request_private (request_id, situation_notes, reason, applicant_feedback)
         VALUES ($1, 'private phone details', 'because', 'call this number')`,
        [requestId],
      );
      await client.query(
        `INSERT INTO private_evidence_metadata (
           request_id, owner_profile_id, file_name, content_type, byte_size, sha256, storage_key
         ) VALUES ($1, $2, 'sample.pdf', 'application/pdf', 32, $3, $4)`,
        [requestId, holder, "a".repeat(64), storageKey],
      );
      await client.query(`SELECT set_config('jirani.trusted_ledger_write', 'on', true)`);
      await client.query(
        `INSERT INTO contributions (
           id, donor_profile_id, request_id, recognition, public_name, gift_minor,
           collected_platform_fee_minor, campaign_borne_fee_minor, provider_fee_minor,
           donor_pays_minor, net_to_cause_minor, status, idempotency_key, provider,
           provider_reference, simulated
         ) VALUES (
           $1, $2, $3, 'public', 'Holder name', 10000,
           0, 0, 0,
           10000, 10000, 'pending', $4, 'mock',
           $5, true
         )`,
        [contributionId, holder, requestId, randomUUID(), `SIM-${randomUUID()}`],
      );
      await expectFailure(
        client,
        `UPDATE profiles SET email = 'changed@close.test' WHERE id = $1`,
        [holder],
        /email are changed/,
      );
      await client.query("SET LOCAL ROLE jirani_app");
      await client.query(`SELECT set_config('jirani.profile_id', $1, true)`, [holder]);
      await client.query(`SELECT set_config('jirani.roles', 'recipient,donor', true)`);
      const closed = await client.query<{ keys: string[] }>("SELECT jirani.close_account($1) AS keys", [holder]);
      expect(closed.rows[0]?.keys).toContain(storageKey);
      await client.query("RESET ROLE");
      const profile = await client.query<{ email: string; phone: string | null; account_status: string; display_name: string }>(
        `SELECT email, phone, account_status, display_name FROM profiles WHERE id = $1`,
        [holder],
      );
      expect(profile.rows[0]?.account_status).toBe("closed");
      expect(profile.rows[0]?.phone).toBeNull();
      expect(profile.rows[0]?.display_name).toBe("Closed account");
      expect(profile.rows[0]?.email.endsWith("@accounts.invalid")).toBe(true);
      const credentials = await client.query(`SELECT 1 FROM auth_credentials WHERE profile_id = $1`, [holder]);
      expect(credentials.rowCount).toBe(0);
      const notes = await client.query<{ situation_notes: string }>(
        `SELECT situation_notes FROM assistance_request_private WHERE request_id = $1`,
        [requestId],
      );
      expect(notes.rows[0]?.situation_notes).toBe("");
      const evidence = await client.query(`SELECT 1 FROM private_evidence_metadata WHERE request_id = $1`, [requestId]);
      expect(evidence.rowCount).toBe(0);
      const gift = await client.query<{ gift_minor: string; public_name: string | null; public_name_retired: boolean }>(
        `SELECT gift_minor, public_name, public_name_retired FROM contributions WHERE id = $1`,
        [contributionId],
      );
      expect(gift.rows[0]?.gift_minor).toBe("10000");
      expect(gift.rows[0]?.public_name).toBeNull();
      expect(gift.rows[0]?.public_name_retired).toBe(true);
      const sameEmail = await client.query(
        `SELECT 1 FROM profiles WHERE lower(email) = lower($1)`,
        [`${holder}@close.test`],
      );
      expect(sameEmail.rowCount).toBe(0);
      await client.query("SET LOCAL ROLE jirani_app");
      await client.query(`SELECT set_config('jirani.profile_id', $1, true)`, [keeper]);
      await client.query(`SELECT set_config('jirani.roles', 'administrator', true)`);
      await expectFailure(client, `SELECT jirani.close_account($1)`, [keeper], /last administrator/);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});

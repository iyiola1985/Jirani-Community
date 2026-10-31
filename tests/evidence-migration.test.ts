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

describe("evidence review migration", () => {
  it("keeps review changes and other people's files closed, then rolls back", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const client = new pg.Client({
      connectionString: databaseUrl ? ownerUrl(databaseUrl) : "postgresql://suddenlly@localhost:5432/jirani",
    });
    try {
      await client.connect();
    } catch {
      throw new Error("The evidence migration test could not open a database connection.");
    }
    const applicant = randomUUID();
    const other = randomUUID();
    const reviewer = randomUUID();
    const requestId = randomUUID();
    const evidenceId = randomUUID();
    const storageKey = `${randomUUID()}.pdf`;
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(new URL("../db/migrations/0013_evidence_review.sql", import.meta.url), "utf8"));
      await client.query(`SELECT set_config('jirani.trusted_role_write', 'on', true)`);
      await client.query(
        `INSERT INTO profiles (id, public_display_name, display_name, email) VALUES
           ($1, 'Evidence applicant', 'Evidence applicant', $2),
           ($3, 'Evidence neighbour', 'Evidence neighbour', $4),
           ($5, 'Evidence reviewer', 'Evidence reviewer', $6)`,
        [applicant, `${applicant}@evidence.test`, other, `${other}@evidence.test`, reviewer, `${reviewer}@evidence.test`],
      );
      await client.query(
        `INSERT INTO user_roles (profile_id, role) VALUES ($1, 'recipient'), ($2, 'recipient'), ($3, 'administrator')`,
        [applicant, other, reviewer],
      );
      await client.query(`SELECT set_config('jirani.profile_id', $1, true)`, [applicant]);
      await client.query(`SELECT set_config('jirani.roles', 'recipient', true)`);
      await client.query(
        `INSERT INTO assistance_requests (
           id, recipient_profile_id, public_alias, category, title, public_summary, county, amount_needed_minor, status
         ) VALUES (
           $1, $2, 'Neighbour', 'food', 'Food for a test household',
           'This is a rollback-only application used to test private evidence rules.',
           'Nairobi', 100000, 'draft'
         )`,
        [requestId, applicant],
      );
      await client.query(
        `INSERT INTO private_evidence_metadata (
           id, request_id, owner_profile_id, file_name, content_type, byte_size, sha256, storage_key, category
         ) VALUES ($1, $2, $3, 'sample.pdf', 'application/pdf', 32, $4, $5, 'hospital_bill')`,
        [evidenceId, requestId, applicant, "a".repeat(64), storageKey],
      );
      await expectFailure(
        client,
        `INSERT INTO private_evidence_metadata (
           request_id, owner_profile_id, file_name, content_type, byte_size, sha256, storage_key
         ) VALUES ($1, $2, 'bad.pdf', 'application/pdf', 32, $3, '../etc/passwd')`,
        [requestId, applicant, "b".repeat(64)],
        /check|storage_key|violates/i,
      );
      await expectFailure(
        client,
        `UPDATE private_evidence_metadata SET review_status = 'verified' WHERE id = $1`,
        [evidenceId],
        /cannot be changed directly/i,
      );
      await client.query(`SELECT set_config('jirani.profile_id', $1, true)`, [applicant]);
      await client.query(`SELECT set_config('jirani.roles', 'recipient', true)`);
      await client.query(`SET LOCAL ROLE jirani_app`);
      const blocked = await client.query(
        `UPDATE private_evidence_metadata SET review_status = 'verified' WHERE id = $1`,
        [evidenceId],
      );
      expect(blocked.rowCount).toBe(0);
      const unchanged = await client.query(`SELECT review_status FROM private_evidence_metadata WHERE id = $1`, [evidenceId]);
      expect(unchanged.rows[0].review_status).toBe("pending_review");
      await expectFailure(
        client,
        `SELECT jirani.review_private_evidence($1, 'verified', 'I approve my own file', false)`,
        [evidenceId],
        /only an administrator|cannot review/i,
      );
      const hidden = await client.query(`SELECT count(*)::int AS total FROM private_evidence_metadata WHERE id = $1`, [evidenceId]);
      expect(Number(hidden.rows[0].total)).toBe(1);
      await client.query(`SELECT set_config('jirani.profile_id', $1, true)`, [other]);
      const otherView = await client.query(`SELECT count(*)::int AS total FROM private_evidence_metadata WHERE id = $1`, [evidenceId]);
      expect(Number(otherView.rows[0].total)).toBe(0);
      await client.query(`SELECT set_config('jirani.profile_id', $1, true)`, [reviewer]);
      await client.query(`SELECT set_config('jirani.roles', 'administrator', true)`);
      await client.query(`SELECT jirani.review_private_evidence($1, 'needs_clarification', 'Please add the discharge note', false)`, [evidenceId]);
      const reviewed = await client.query(`SELECT review_status FROM private_evidence_metadata WHERE id = $1`, [evidenceId]);
      expect(reviewed.rows[0].review_status).toBe("needs_clarification");
      await client.query(`RESET ROLE`);
      await client.query(`SELECT set_config('jirani.profile_id', $1, true)`, [applicant]);
      await client.query(`SELECT set_config('jirani.status_reason', 'Submitted for the evidence test.', true)`);
      await client.query(`UPDATE assistance_requests SET status = 'submitted' WHERE id = $1`, [requestId]);
      await client.query(`SET LOCAL ROLE jirani_app`);
      await expectFailure(
        client,
        `SELECT jirani.remove_pending_evidence($1)`,
        [evidenceId],
        /already submitted stays|reviewed file stays/i,
      );
      const stillThere = await client.query(`SELECT count(*)::int AS total FROM private_evidence_metadata WHERE id = $1`, [evidenceId]);
      expect(Number(stillThere.rows[0].total)).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });
});

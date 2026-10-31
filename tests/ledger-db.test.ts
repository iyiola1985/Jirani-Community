import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

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
const hash = "scrypt:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describeLive("persistent simulated ledger", () => {
  const client = new pg.Client({ connectionString: url });

  beforeAll(async () => {
    await client.connect();
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  afterAll(async () => {
    await client.end();
  });

  async function asUser(id: string, roles: string) {
    await client.query("SELECT set_config('jirani.profile_id', $1, true)", [id]);
    await client.query("SELECT set_config('jirani.roles', $1, true)", [roles]);
  }

  async function expectRaise(sql: string, params: unknown[], pattern: RegExp) {
    await client.query("SAVEPOINT attempt");
    await expect(client.query(sql, params)).rejects.toThrow(pattern);
    await client.query("ROLLBACK TO SAVEPOINT attempt");
  }

  it("records a simulated gift, blocks edits, and keeps closed history", async () => {
    await client.query("BEGIN");
    const recipient = randomUUID();
    const donor = randomUUID();
    const other = randomUUID();
    await client.query(
      `SELECT jirani.register_account($1, 'Amina Applicant', $2, '', 'Kisumu', 'recipient', $3, 'draft-2026-10')`,
      [recipient, `ledger.recipient.${recipient}@example.com`, hash],
    );
    await client.query(
      `SELECT jirani.register_account($1, 'Wanjiru Donor', $2, '', 'Nairobi', 'donor', $3, 'draft-2026-10')`,
      [donor, `ledger.donor.${donor}@example.com`, hash],
    );
    await client.query(
      `SELECT jirani.register_account($1, 'Otieno Other', $2, '', 'Nairobi', 'donor', $3, 'draft-2026-10')`,
      [other, `ledger.other.${other}@example.com`, hash],
    );
    await client.query("SELECT set_config('jirani.trusted_role_write', 'off', true)");
    await asUser(recipient, "recipient");
    const inserted = await client.query(
      `INSERT INTO assistance_requests (
         recipient_profile_id, public_alias, category, title, public_summary, county, amount_needed_minor, status
       ) VALUES (
         $1, 'Neighbour in Kisumu', 'school', 'School fees for a household',
         'Help with a basic school bill for a household in Kisumu County. The public text names the county only.',
         'Kisumu', 450000, 'draft'
       ) RETURNING id`,
      [recipient],
    );
    const requestId = inserted.rows[0].id as string;
    const key = randomUUID();
    await expectRaise(
      `SELECT jirani.record_simulated_contribution($1, 10000, 'anonymous', NULL, $2)`,
      [requestId, key],
      /donor account/i,
    );
    await client.query("SELECT set_config('jirani.status_reason', 'Submitted by the applicant.', true)");
    await client.query("UPDATE assistance_requests SET status = 'submitted' WHERE id = $1", [requestId]);
    await asUser(donor, "administrator");
    await client.query(
      `SELECT jirani.decide_recipient_verification($1, 'verified', 'Records checked for this test.')`,
      [recipient],
    );
    await client.query("SELECT set_config('jirani.status_reason', 'Opened for review.', true)");
    await client.query("UPDATE assistance_requests SET status = 'under_review' WHERE id = $1", [requestId]);
    await client.query("SELECT set_config('jirani.status_reason', 'Request verified.', true)");
    await client.query("UPDATE assistance_requests SET status = 'verified' WHERE id = $1", [requestId]);
    await asUser(donor, "donor");
    await expectRaise(
      `SELECT jirani.record_simulated_contribution($1, 10000, 'anonymous', NULL, $2)`,
      [requestId, key],
      /published/i,
    );
    await asUser(donor, "administrator");
    await client.query("SELECT set_config('jirani.status_reason', 'Published for donors.', true)");
    await client.query("UPDATE assistance_requests SET status = 'published' WHERE id = $1", [requestId]);
    await asUser(donor, "donor");
    await expectRaise(
      `SELECT jirani.record_simulated_contribution($1, 5000, 'anonymous', NULL, $2)`,
      [requestId, randomUUID()],
      /whole number of shillings/i,
    );
    const started = await client.query(
      `SELECT jirani.record_simulated_contribution($1, 10000, 'anonymous', NULL, $2) AS created`,
      [requestId, key],
    );
    const created = started.rows[0].created as { id: string; duplicate: boolean; providerReference: string };
    expect(created.duplicate).toBe(false);
    expect(created.providerReference.startsWith("sim_")).toBe(true);
    const again = await client.query(
      `SELECT jirani.record_simulated_contribution($1, 10000, 'anonymous', NULL, $2) AS created`,
      [requestId, key],
    );
    expect(again.rows[0].created).toMatchObject({ id: created.id, duplicate: true });
    const pendingTotal = await client.query("SELECT jirani.raised_for_published($1) AS raised", [requestId]);
    expect(Number(pendingTotal.rows[0].raised)).toBe(0);
    const failed = await client.query(
      `SELECT jirani.record_simulated_contribution($1, 20000, 'public', 'Wanjiru', $2) AS created`,
      [requestId, randomUUID()],
    );
    const failedId = failed.rows[0].created.id as string;
    await client.query(
      `SELECT jirani.settle_simulated_contribution($1, 'failed', $2)`,
      [failedId, randomUUID()],
    );
    const afterFailure = await client.query("SELECT jirani.raised_for_published($1) AS raised", [requestId]);
    expect(Number(afterFailure.rows[0].raised)).toBe(0);
    await client.query(
      `SELECT jirani.settle_simulated_contribution($1, 'successful', $2)`,
      [created.id, randomUUID()],
    );
    await client.query(
      `SELECT jirani.settle_simulated_contribution($1, 'successful', $2)`,
      [created.id, randomUUID()],
    );
    const raised = await client.query("SELECT jirani.raised_for_published($1) AS raised", [requestId]);
    expect(Number(raised.rows[0].raised)).toBe(10_000);
    const gifts = await client.query("SELECT count(*) AS gifts FROM ledger_entries WHERE contribution_id = $1 AND entry_type = 'gift'", [created.id]);
    expect(Number(gifts.rows[0].gifts)).toBe(1);
    const named = await client.query("SELECT display_name FROM jirani.public_acknowledgements($1)", [requestId]);
    expect(named.rows.map((row) => row.display_name)).toEqual(["Anonymous"]);
    await asUser(other, "donor");
    const hidden = await client.query("SELECT id FROM contributions WHERE id = $1", [created.id]);
    expect(hidden.rowCount).toBe(0);
    const own = await client.query("SELECT id FROM jirani.donor_contributions(NULL)");
    expect(own.rowCount).toBe(0);
    await asUser(donor, "donor");
    const visible = await client.query("SELECT id, receipt_number FROM jirani.donor_contributions($1)", [created.id]);
    expect(visible.rowCount).toBe(1);
    expect(String(visible.rows[0].receipt_number).startsWith("SIM-")).toBe(true);
    await expectRaise(
      "UPDATE contributions SET status = 'failed' WHERE id = $1",
      [created.id],
      /permission denied/i,
    );
    await expectRaise(
      "DELETE FROM ledger_entries WHERE contribution_id = $1",
      [created.id],
      /permission denied/i,
    );
    await asUser(donor, "donor");
    await expectRaise(
      `SELECT jirani.record_simulated_reversal($1, 10000, 'Recorded by mistake for the test.', $2)`,
      [created.id, randomUUID()],
      /administrator/i,
    );
    await asUser(donor, "administrator");
    const reversalKey = randomUUID();
    await client.query(
      `SELECT jirani.record_simulated_reversal($1, 5000, 'Partial demonstration reversal.', $2)`,
      [created.id, reversalKey],
    );
    await client.query(
      `SELECT jirani.record_simulated_reversal($1, 5000, 'Partial demonstration reversal.', $2)`,
      [created.id, reversalKey],
    );
    const net = await client.query("SELECT jirani.raised_for_request($1) AS raised", [requestId]);
    expect(Number(net.rows[0].raised)).toBe(5_000);
    const refunds = await client.query("SELECT count(*) AS refunds FROM refunds WHERE contribution_id = $1", [created.id]);
    expect(Number(refunds.rows[0].refunds)).toBe(1);
    const original = await client.query("SELECT gift_minor, status FROM contributions WHERE id = $1", [created.id]);
    expect(Number(original.rows[0].gift_minor)).toBe(10_000);
    expect(original.rows[0].status).toBe("successful");
    await expectRaise(
      `SELECT jirani.record_simulated_reversal($1, 10000, 'This is larger than the remainder.', $2)`,
      [created.id, randomUUID()],
      /larger than/i,
    );
    const beforeClose = await client.query("SELECT count(*) AS entries FROM ledger_entries WHERE contribution_id = $1", [created.id]);
    await client.query("SELECT set_config('jirani.status_reason', 'The household no longer needs this open.', true)");
    await client.query("UPDATE assistance_requests SET status = 'closed' WHERE id = $1", [requestId]);
    const afterClose = await client.query("SELECT count(*) AS entries FROM ledger_entries WHERE contribution_id = $1", [created.id]);
    expect(Number(afterClose.rows[0].entries)).toBe(Number(beforeClose.rows[0].entries));
    const preserved = await client.query("SELECT jirani.raised_for_request($1) AS raised", [requestId]);
    expect(Number(preserved.rows[0].raised)).toBe(5_000);
    await asUser(donor, "donor");
    await expectRaise(
      `SELECT jirani.record_simulated_contribution($1, 10000, 'anonymous', NULL, $2)`,
      [requestId, randomUUID()],
      /published/i,
    );
    await asUser(donor, "administrator");
    const audit = await client.query(
      "SELECT action FROM administrative_audit_logs WHERE entity_id = $1 ORDER BY created_at",
      [created.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "contribution.started",
      "payment.successful",
      "payment.refunded",
    ]);
    const definition = await client.query(
      "SELECT pg_get_functiondef('jirani.record_simulated_contribution(uuid,bigint,recognition,text,text)'::regprocedure) AS source",
    );
    expect(definition.rows[0].source).toMatch(/cannot contribute to your own request/);
  });
});

describeLive("concurrent simulated gifts", () => {
  it("waits for an in-flight gift with the same key and leaves nothing behind", async () => {
    const setup = new pg.Client({ connectionString: url });
    await setup.connect();
    const request = await setup.query(
      "SELECT id FROM assistance_requests WHERE status = 'published' AND demo = false LIMIT 1",
    );
    const requestId = request.rows[0]?.id as string | undefined;
    if (!requestId) {
      await setup.end();
      throw new Error("A published request is required for the concurrency check.");
    }
    const donorId = randomUUID();
    await setup.query(
      `SELECT jirani.register_account($1, 'Concurrency Donor', $2, '', 'Nairobi', 'donor', $3, 'draft-2026-10')`,
      [donorId, `concurrency.${donorId}@example.com`, hash],
    );
    await setup.end();
    const first = new pg.Client({ connectionString: url });
    const second = new pg.Client({ connectionString: url });
    await first.connect();
    await second.connect();
    await second.query("SET lock_timeout = '5s'");
    const key = randomUUID();
    try {
      await first.query("BEGIN");
      await first.query("SELECT set_config('jirani.profile_id', $1, true)", [donorId]);
      await first.query("SELECT set_config('jirani.roles', 'donor', true)");
      await first.query(
        "SELECT jirani.record_simulated_contribution($1, 10000, 'anonymous', NULL, $2)",
        [requestId, key],
      );
      const pending = (async () => {
        await second.query("BEGIN");
        await second.query("SELECT set_config('jirani.profile_id', $1, true)", [donorId]);
        await second.query("SELECT set_config('jirani.roles', 'donor', true)");
        await second.query(
          "SELECT jirani.record_simulated_contribution($1, 10000, 'anonymous', NULL, $2)",
          [requestId, key],
        );
      })();
      const winner = await Promise.race([
        pending.then(() => "second"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 400)),
      ]);
      expect(winner).toBe("waiting");
      await first.query("ROLLBACK");
      await pending;
      await second.query("ROLLBACK");
      const left = await lookupCount(key);
      expect(left).toBe(0);
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await second.query("ROLLBACK").catch(() => undefined);
      await first.end();
      await second.end();
      const owner = new pg.Client({ connectionString: "postgresql://suddenlly@localhost:5432/jirani" });
      await owner.connect();
      try {
        await owner.query("BEGIN");
        await owner.query("SELECT set_config('jirani.trusted_role_write', 'on', true)");
        await owner.query("DELETE FROM consent_records WHERE profile_id = $1", [donorId]);
        await owner.query("DELETE FROM auth_credentials WHERE profile_id = $1", [donorId]);
        await owner.query("DELETE FROM user_roles WHERE profile_id = $1", [donorId]);
        await owner.query("DELETE FROM profiles WHERE id = $1", [donorId]);
        await owner.query("COMMIT");
      } finally {
        await owner.query("ROLLBACK").catch(() => undefined);
        await owner.end();
      }
    }

    async function lookupCount(idempotencyKey: string) {
      const check = new pg.Client({ connectionString: url });
      await check.connect();
      try {
        const result = await check.query("SELECT count(*) AS rows FROM contributions WHERE idempotency_key = $1", [idempotencyKey]);
        return Number(result.rows[0].rows);
      } finally {
        await check.end();
      }
    }
  });
});

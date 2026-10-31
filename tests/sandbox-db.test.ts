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
const objective = "This campaign funds school fees for reviewed households in Kisumu during the month. It does not pay a bill by itself.";
const eligibility = "Reviewed households in Kisumu with a school bill and a published county. Private documents stay with the reviewer.";
const selection = "An administrator records one manual decision against this eligibility rule. The decision cannot be silently rerun.";
const fee = "The platform fee for this campaign is KSh 0. Donors see that before confirming.";
const refund = "An administrator records a reversal as a new ledger row. The original gift stays.";
const surplus = "Surplus stays with this campaign until a reviewed allocation. It is not moved to another campaign.";

describeLive("sandbox payment adapter", () => {
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

  async function register(role: "donor" | "recipient") {
    const id = randomUUID();
    await client.query(
      `SELECT jirani.register_account($1, $2, $3, '', 'Kisumu', $4, $5, 'draft-2026-10')`,
      [id, role === "donor" ? "Wanjiru Donor" : "Amina Applicant", `${role}.${id}@example.com`, role, hash],
    );
    return id;
  }

  async function publishRequest(recipient: string, donor: string) {
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
    await client.query("SELECT set_config('jirani.status_reason', 'Submitted by the applicant.', true)");
    await client.query("UPDATE assistance_requests SET status = 'submitted' WHERE id = $1", [requestId]);
    await asUser(donor, "administrator");
    await client.query(`SELECT jirani.decide_recipient_verification($1, 'verified', 'Records checked for this test.')`, [recipient]);
    await client.query("SELECT set_config('jirani.status_reason', 'Opened for review.', true)");
    await client.query("UPDATE assistance_requests SET status = 'under_review' WHERE id = $1", [requestId]);
    await client.query("SELECT set_config('jirani.status_reason', 'Request verified.', true)");
    await client.query("UPDATE assistance_requests SET status = 'verified' WHERE id = $1", [requestId]);
    await client.query("SELECT set_config('jirani.status_reason', 'Published for donors.', true)");
    await client.query("UPDATE assistance_requests SET status = 'published' WHERE id = $1", [requestId]);
    return requestId;
  }

  async function openPayment(donor: string, requestId: string | null, campaignId: string | null) {
    await asUser(donor, "donor");
    const begun = await client.query(
      `SELECT jirani.begin_sandbox_payment($1, $2, 10000, 'anonymous', NULL, $3, 'sandbox-mock') AS created`,
      [requestId, campaignId, randomUUID()],
    );
    const created = begun.rows[0].created as { id: string; status: string };
    const reference = `sbx_${randomUUID().replaceAll("-", "")}`;
    await client.query(`SELECT jirani.attach_sandbox_reference($1, $2)`, [created.id, reference]);
    return { id: created.id, reference };
  }

  function apply(reference: string, outcome: string, amount = 10_000, eventId = randomUUID().replaceAll("-", "")) {
    return client.query(
      `SELECT jirani.apply_sandbox_verification($1, $2, $3, $4, 'KES') AS applied`,
      [reference, eventId, outcome, amount],
    );
  }

  it("posts one verified gift and ignores duplicates, bad amounts, and later failures", async () => {
    await client.query("BEGIN");
    const recipient = await register("recipient");
    const donor = await register("donor");
    const requestId = await publishRequest(recipient, donor);
    await asUser(recipient, "recipient");
    await expectRaise(
      `SELECT jirani.begin_sandbox_payment($1, NULL, 10000, 'anonymous', NULL, $2, 'sandbox-mock')`,
      [requestId, randomUUID()],
      /donor account/i,
    );
    await asUser(donor, "donor");
    await expectRaise(
      `INSERT INTO sandbox_payments (
         donor_profile_id, request_id, gift_minor, provider, internal_reference, idempotency_key, recognition
       ) VALUES ($1, $2, 10000, 'sandbox-mock', 'pay_directinsert0001', $3, 'anonymous')`,
      [donor, requestId, randomUUID()],
      /permission denied/i,
    );
    const firstKey = randomUUID();
    const started = await client.query(
      `SELECT jirani.begin_sandbox_payment($1, NULL, 10000, 'anonymous', NULL, $2, 'sandbox-mock') AS created`,
      [requestId, firstKey],
    );
    const again = await client.query(
      `SELECT jirani.begin_sandbox_payment($1, NULL, 10000, 'anonymous', NULL, $2, 'sandbox-mock') AS created`,
      [requestId, firstKey],
    );
    expect(again.rows[0].created.id).toBe(started.rows[0].created.id);
    expect(again.rows[0].created.duplicate).toBe(true);
    const reference = `sbx_${randomUUID().replaceAll("-", "")}`;
    await client.query(`SELECT jirani.attach_sandbox_reference($1, $2)`, [started.rows[0].created.id, reference]);
    const pendingRaised = await client.query("SELECT jirani.raised_for_published($1) AS raised", [requestId]);
    expect(Number(pendingRaised.rows[0].raised)).toBe(0);
    const unknown = await apply(`sbx_${"c".repeat(32)}`, "successful");
    expect(unknown.rows[0].applied.result).toBe("unknown");
    const mismatch = await apply(reference, "successful", 20_000);
    expect(mismatch.rows[0].applied.result).toBe("quarantined");
    const quarantinedRaised = await client.query("SELECT jirani.raised_for_published($1) AS raised", [requestId]);
    expect(Number(quarantinedRaised.rows[0].raised)).toBe(0);

    const retry = await openPayment(donor, requestId, null);
    const eventId = randomUUID().replaceAll("-", "");
    await client.query("SAVEPOINT crash");
    const crashed = await apply(retry.reference, "successful", 10_000, eventId);
    expect(crashed.rows[0].applied.result).toBe("posted");
    await client.query("ROLLBACK TO SAVEPOINT crash");
    const recovered = await apply(retry.reference, "successful", 10_000, eventId);
    expect(recovered.rows[0].applied.result).toBe("posted");
    const duplicate = await apply(retry.reference, "successful", 10_000, eventId);
    expect(duplicate.rows[0].applied.result).toBe("duplicate");
    const lateFailure = await apply(retry.reference, "failed");
    expect(lateFailure.rows[0].applied.result).toBe("kept-success");
    const gifts = await client.query(
      `SELECT count(*) AS n FROM ledger_entries e
       JOIN contributions c ON c.id = e.contribution_id
       WHERE c.request_id = $1 AND e.entry_type = 'gift'`,
      [requestId],
    );
    expect(Number(gifts.rows[0].n)).toBe(1);
    const raised = await client.query("SELECT jirani.raised_for_published($1) AS raised", [requestId]);
    expect(Number(raised.rows[0].raised)).toBe(10_000);
    const reversalEvent = randomUUID().replaceAll("-", "");
    const reversed = await apply(retry.reference, "reversed", 10_000, reversalEvent);
    expect(reversed.rows[0].applied.result).toBe("reversed");
    const reversalAgain = await apply(retry.reference, "reversed", 10_000, reversalEvent);
    expect(reversalAgain.rows[0].applied.result).toBe("duplicate");
    const net = await client.query("SELECT jirani.raised_for_request($1) AS raised", [requestId]);
    expect(Number(net.rows[0].raised)).toBe(0);

    const failed = await openPayment(donor, requestId, null);
    const failedResult = await apply(failed.reference, "failed");
    expect(failedResult.rows[0].applied.result).toBe("failed");
    const fresh = await openPayment(donor, requestId, null);
    const posted = await apply(fresh.reference, "successful");
    expect(posted.rows[0].applied.result).toBe("posted");
    const other = await register("donor");
    await asUser(other, "donor");
    const hidden = await client.query("SELECT id FROM sandbox_payments WHERE id = $1", [fresh.id]);
    expect(hidden.rowCount).toBe(0);
  });

  it("keeps a verified campaign payment out of the total after the campaign closes", async () => {
    await client.query("BEGIN");
    const admin = await register("recipient");
    const donor = await register("donor");
    await asUser(admin, "administrator");
    const saved = await client.query(
      `SELECT jirani.save_campaign(
         NULL, 'School fees in Kisumu', $1, 'school', $2, 500000, $3, $4, 'Kisumu',
         'Households in Kisumu', $5, $6, $7, $8, $9, false, NULL
       ) AS id`,
      [
        `school-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        objective,
        new Date(Date.now() - 86_400_000).toISOString(),
        new Date(Date.now() + 20 * 86_400_000).toISOString(),
        eligibility,
        selection,
        fee,
        refund,
        surplus,
      ],
    );
    const campaignId = saved.rows[0].id as string;
    await client.query(`SELECT jirani.transition_campaign($1, 'under_review', 'Ready for a second look.')`, [campaignId]);
    await client.query(`SELECT jirani.transition_campaign($1, 'approved', 'Rules and disclosures are complete.')`, [campaignId]);
    await client.query(`SELECT jirani.transition_campaign($1, 'active', 'The campaign is inside its dates.')`, [campaignId]);
    const payment = await openPayment(donor, null, campaignId);
    await asUser(admin, "administrator");
    await client.query(`SELECT jirani.transition_campaign($1, 'closed', 'Closed while a sandbox payment was pending.')`, [campaignId]);
    const applied = await apply(payment.reference, "successful");
    expect(applied.rows[0].applied.result).toBe("quarantined");
    const raised = await client.query("SELECT jirani.raised_for_campaign($1) AS raised", [campaignId]);
    expect(Number(raised.rows[0].raised)).toBe(0);
    const rows = await client.query("SELECT count(*) AS n FROM contributions WHERE campaign_id = $1", [campaignId]);
    expect(Number(rows.rows[0].n)).toBe(0);
  });

  it("does not let the application role start a Daraja payment or post an unknown receipt", async () => {
    await client.query("BEGIN");
    const recipient = await register("recipient");
    const donor = await register("donor");
    const requestId = await publishRequest(recipient, donor);
    await asUser(donor, "donor");
    await expectRaise(
      `SELECT jirani.begin_sandbox_payment($1, NULL, 10000, 'anonymous', NULL, $2, 'daraja-sandbox')`,
      [requestId, randomUUID()],
      /not configured/i,
    );
    const reference = `sbx_${randomUUID().replaceAll("-", "")}`;
    const applied = await apply(reference, "successful");
    expect(applied.rows[0].applied.result).toBe("unknown");
    const contributions = await client.query("SELECT count(*) AS n FROM contributions WHERE request_id = $1", [requestId]);
    expect(Number(contributions.rows[0].n)).toBe(0);
    const ledger = await client.query(
      `SELECT count(*) AS n FROM ledger_entries e
       JOIN contributions c ON c.id = e.contribution_id
       WHERE c.request_id = $1`,
      [requestId],
    );
    expect(Number(ledger.rows[0].n)).toBe(0);
  });
});

function ownerUrl(appUrl: string): string {
  const parsed = new URL(appUrl);
  parsed.username = "suddenlly";
  parsed.password = "";
  return parsed.toString().replace("suddenlly:@", "suddenlly@");
}

describeLive("Daraja database posting gate", () => {
  const owner = new pg.Client({ connectionString: url ? ownerUrl(url) : "postgresql://suddenlly@localhost:5432/jirani" });

  beforeAll(async () => {
    try {
      await owner.connect();
    } catch {
      throw new Error("The database owner connection for the Daraja gate test could not be opened.");
    }
  });

  afterEach(async () => {
    await owner.query("ROLLBACK");
  });

  afterAll(async () => {
    await owner.end();
  });

  it("returns disabled for a matching Daraja row and writes no contribution or ledger entry", async () => {
    await owner.query("BEGIN");
    const recipient = randomUUID();
    const donor = randomUUID();
    await owner.query(
      `SELECT jirani.register_account($1, 'Amina Applicant', $2, '', 'Kisumu', 'recipient', $3, 'draft-2026-10')`,
      [recipient, `recipient.${recipient}@example.com`, hash],
    );
    await owner.query(
      `SELECT jirani.register_account($1, 'Wanjiru Donor', $2, '', 'Kisumu', 'donor', $3, 'draft-2026-10')`,
      [donor, `donor.${donor}@example.com`, hash],
    );
    await owner.query("SELECT set_config('jirani.profile_id', $1, true)", [recipient]);
    await owner.query("SELECT set_config('jirani.roles', 'recipient', true)");
    const inserted = await owner.query(
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
    await owner.query("SELECT set_config('jirani.status_reason', 'Submitted by the applicant.', true)");
    await owner.query("UPDATE assistance_requests SET status = 'submitted' WHERE id = $1", [requestId]);
    await owner.query("SELECT set_config('jirani.profile_id', $1, true)", [donor]);
    await owner.query("SELECT set_config('jirani.roles', 'administrator', true)");
    await owner.query(`SELECT jirani.decide_recipient_verification($1, 'verified', 'Records checked for this test.')`, [recipient]);
    await owner.query("SELECT set_config('jirani.status_reason', 'Opened for review.', true)");
    await owner.query("UPDATE assistance_requests SET status = 'under_review' WHERE id = $1", [requestId]);
    await owner.query("SELECT set_config('jirani.status_reason', 'Request verified.', true)");
    await owner.query("UPDATE assistance_requests SET status = 'verified' WHERE id = $1", [requestId]);
    await owner.query("SELECT set_config('jirani.status_reason', 'Published for donors.', true)");
    await owner.query("UPDATE assistance_requests SET status = 'published' WHERE id = $1", [requestId]);

    const reference = `LHG${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    const internalReference = `pay_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    await owner.query("SELECT set_config('jirani.trusted_sandbox_write', 'on', true)");
    const payment = await owner.query(
      `INSERT INTO sandbox_payments (
         donor_profile_id, request_id, gift_minor, provider, provider_reference,
         internal_reference, idempotency_key, status, recognition
       ) VALUES ($1, $2, 10000, 'daraja-sandbox', $3, $4, $5, 'pending', 'anonymous')
       RETURNING id`,
      [donor, requestId, reference, internalReference, randomUUID()],
    );
    await owner.query("SELECT set_config('jirani.trusted_sandbox_write', 'off', true)");
    const paymentId = payment.rows[0].id as string;

    await owner.query("SET LOCAL ROLE jirani_app");
    for (const outcome of ["successful", "failed", "reversed"]) {
      const applied = await owner.query(
        `SELECT jirani.apply_sandbox_verification($1, $2, $3, 10000, 'KES') AS applied`,
        [reference, randomUUID().replaceAll("-", ""), outcome],
      );
      expect(applied.rows[0].applied.result).toBe("disabled");
      expect(applied.rows[0].applied.id).toBe(paymentId);
    }
    await owner.query("RESET ROLE");

    const stored = await owner.query("SELECT status, contribution_id FROM sandbox_payments WHERE id = $1", [paymentId]);
    expect(stored.rows[0].status).toBe("pending");
    expect(stored.rows[0].contribution_id).toBeNull();
    const contributions = await owner.query("SELECT count(*) AS n FROM contributions WHERE request_id = $1", [requestId]);
    expect(Number(contributions.rows[0].n)).toBe(0);
    const ledger = await owner.query(
      `SELECT count(*) AS n FROM ledger_entries e
       JOIN contributions c ON c.id = e.contribution_id
       WHERE c.request_id = $1`,
      [requestId],
    );
    expect(Number(ledger.rows[0].n)).toBe(0);
    const refunds = await owner.query(
      `SELECT count(*) AS n FROM refunds r
       JOIN contributions c ON c.id = r.contribution_id
       WHERE c.request_id = $1`,
      [requestId],
    );
    expect(Number(refunds.rows[0].n)).toBe(0);
  });

  it("blocks status changes, conflicting results, direct writes, and other ledger functions", async () => {
    await owner.query("BEGIN");
    const recipient = randomUUID();
    const donor = randomUUID();
    await owner.query(
      `SELECT jirani.register_account($1, 'Amina Applicant', $2, '', 'Kisumu', 'recipient', $3, 'draft-2026-10')`,
      [recipient, `recipient.${recipient}@example.com`, hash],
    );
    await owner.query(
      `SELECT jirani.register_account($1, 'Wanjiru Donor', $2, '', 'Kisumu', 'donor', $3, 'draft-2026-10')`,
      [donor, `donor.${donor}@example.com`, hash],
    );
    await owner.query("SELECT set_config('jirani.profile_id', $1, true)", [recipient]);
    await owner.query("SELECT set_config('jirani.roles', 'recipient', true)");
    const inserted = await owner.query(
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
    await owner.query("SELECT set_config('jirani.status_reason', 'Submitted by the applicant.', true)");
    await owner.query("UPDATE assistance_requests SET status = 'submitted' WHERE id = $1", [requestId]);
    await owner.query("SELECT set_config('jirani.profile_id', $1, true)", [donor]);
    await owner.query("SELECT set_config('jirani.roles', 'administrator', true)");
    await owner.query(`SELECT jirani.decide_recipient_verification($1, 'verified', 'Records checked for this test.')`, [recipient]);
    await owner.query("SELECT set_config('jirani.status_reason', 'Opened for review.', true)");
    await owner.query("UPDATE assistance_requests SET status = 'under_review' WHERE id = $1", [requestId]);
    await owner.query("SELECT set_config('jirani.status_reason', 'Request verified.', true)");
    await owner.query("UPDATE assistance_requests SET status = 'verified' WHERE id = $1", [requestId]);
    await owner.query("SELECT set_config('jirani.status_reason', 'Published for donors.', true)");
    await owner.query("UPDATE assistance_requests SET status = 'published' WHERE id = $1", [requestId]);

    const reference = `LHG${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    await owner.query("SELECT set_config('jirani.trusted_sandbox_write', 'on', true)");
    const payment = await owner.query(
      `INSERT INTO sandbox_payments (
         donor_profile_id, request_id, gift_minor, provider, provider_reference,
         internal_reference, idempotency_key, status, recognition
       ) VALUES ($1, $2, 10000, 'daraja-sandbox', $3, $4, $5, 'pending', 'anonymous')
       RETURNING id`,
      [donor, requestId, reference, `pay_${randomUUID().replaceAll("-", "").slice(0, 20)}`, randomUUID()],
    );
    await owner.query("SELECT set_config('jirani.trusted_sandbox_write', 'off', true)");
    const paymentId = payment.rows[0].id as string;

    const privileges = await owner.query(
      `SELECT
         has_table_privilege('jirani_app', 'contributions', 'INSERT') AS insert_contribution,
         has_table_privilege('jirani_app', 'contributions', 'UPDATE') AS update_contribution,
         has_table_privilege('jirani_app', 'ledger_entries', 'INSERT') AS insert_ledger,
         has_table_privilege('jirani_app', 'refunds', 'INSERT') AS insert_refund,
         has_table_privilege('jirani_app', 'sandbox_payments', 'UPDATE') AS update_payment`,
    );
    expect(privileges.rows[0]).toEqual({
      insert_contribution: false,
      update_contribution: false,
      insert_ledger: false,
      insert_refund: false,
      update_payment: false,
    });
    const definition = await owner.query(
      `SELECT pg_get_functiondef('jirani.apply_sandbox_verification(text,text,text,bigint,text)'::regprocedure) AS body`,
    );
    expect(String(definition.rows[0].body)).toContain("payment.provider IS DISTINCT FROM 'sandbox-mock'");
    const trigger = await owner.query(`SELECT pg_get_functiondef('jirani.require_ledger_writer()'::regprocedure) AS body`);
    expect(String(trigger.rows[0].body)).toContain("NEW.provider = 'sandbox-mock' AND NEW.simulated IS TRUE");
    expect(String(trigger.rows[0].body)).not.toContain("NEW.provider = 'daraja-sandbox'");

    async function expectOwnerRaise(sql: string, params: unknown[], pattern: RegExp) {
      await owner.query("SAVEPOINT attempt");
      await expect(owner.query(sql, params)).rejects.toThrow(pattern);
      await owner.query("ROLLBACK TO SAVEPOINT attempt");
    }

    await owner.query("SET LOCAL ROLE jirani_app");
    const mismatch = await owner.query(
      `SELECT jirani.apply_sandbox_verification($1, $2, 'successful', 20000, 'KES') AS applied`,
      [reference, randomUUID().replaceAll("-", "")],
    );
    expect(mismatch.rows[0].applied.result).toBe("disabled");
    const repeatedEvent = randomUUID().replaceAll("-", "");
    const first = await owner.query(
      `SELECT jirani.apply_sandbox_verification($1, $2, 'cancelled', 10000, 'KES') AS applied`,
      [reference, repeatedEvent],
    );
    const second = await owner.query(
      `SELECT jirani.apply_sandbox_verification($1, $2, 'successful', 10000, 'KES') AS applied`,
      [reference, repeatedEvent],
    );
    expect(first.rows[0].applied.result).toBe("disabled");
    expect(second.rows[0].applied.result).toBe("disabled");
    await expectOwnerRaise(
      `UPDATE sandbox_payments SET status = 'successful', provider = 'sandbox-mock' WHERE id = $1`,
      [paymentId],
      /permission denied/i,
    );
    await expectOwnerRaise(
      `INSERT INTO contributions (
         donor_profile_id, request_id, recognition, gift_minor,
         collected_platform_fee_minor, campaign_borne_fee_minor, provider_fee_minor,
         donor_pays_minor, net_to_cause_minor, status, idempotency_key, provider, provider_reference, simulated
       ) VALUES ($1, $2, 'anonymous', 10000, 0, 0, 0, 10000, 10000, 'pending', $3, 'daraja-sandbox', $4, false)`,
      [donor, requestId, randomUUID(), `daraja_${randomUUID().replaceAll("-", "")}`],
      /permission denied/i,
    );
    await expectOwnerRaise(
      `INSERT INTO ledger_entries (contribution_id, entry_type, amount_minor, reason)
       VALUES ($1, 'gift', 10000, 'Untrusted Daraja write.')`,
      [randomUUID()],
      /permission denied/i,
    );
    await expectOwnerRaise(
      `INSERT INTO refunds (contribution_id, amount_minor, reason, idempotency_key, approved_by, simulated)
       VALUES ($1, 10000, 'Untrusted Daraja refund.', $2, $3, false)`,
      [randomUUID(), randomUUID(), donor],
      /permission denied/i,
    );
    await expectOwnerRaise(
      `SELECT jirani.settle_simulated_contribution($1, 'successful', $2)`,
      [randomUUID(), randomUUID()],
      /simulation/i,
    );
    await expectOwnerRaise(
      `SELECT jirani.record_simulated_reversal($1, 10000, 'Untrusted Daraja reversal.', $2)`,
      [randomUUID(), randomUUID()],
      /simulated/i,
    );
    await owner.query("RESET ROLE");

    const stillPending = await owner.query("SELECT status, provider, contribution_id FROM sandbox_payments WHERE id = $1", [paymentId]);
    expect(stillPending.rows[0]).toMatchObject({ status: "pending", provider: "daraja-sandbox", contribution_id: null });

    await owner.query("SELECT set_config('jirani.profile_id', $1, true)", [donor]);
    const attached = await owner.query(`SELECT jirani.attach_sandbox_reference($1, $2) AS attached`, [paymentId, `sbx_${randomUUID().replaceAll("-", "")}`]);
    expect(attached.rows[0].attached.duplicate).toBe(true);
    await owner.query(`SELECT jirani.fail_sandbox_initiation($1, 'Daraja initiation was not accepted.')`, [paymentId]);

    await owner.query("SELECT set_config('jirani.trusted_sandbox_write', 'on', true)");
    await owner.query("UPDATE sandbox_payments SET status = 'successful' WHERE id = $1", [paymentId]);
    await owner.query("SELECT set_config('jirani.trusted_sandbox_write', 'off', true)");
    await owner.query("SET LOCAL ROLE jirani_app");
    for (const outcome of ["successful", "reversed"]) {
      const applied = await owner.query(
        `SELECT jirani.apply_sandbox_verification($1, $2, $3, 10000, 'KES') AS applied`,
        [reference, randomUUID().replaceAll("-", ""), outcome],
      );
      expect(applied.rows[0].applied.result).toBe("disabled");
    }
    await owner.query("RESET ROLE");

    await owner.query("SAVEPOINT trigger_attempt");
    await owner.query("SELECT set_config('jirani.trusted_ledger_write', 'on', true)");
    await owner.query("SELECT set_config('jirani.trusted_verified_payment', 'on', true)");
    await expect(owner.query(
      `INSERT INTO contributions (
         donor_profile_id, request_id, recognition, gift_minor,
         collected_platform_fee_minor, campaign_borne_fee_minor, provider_fee_minor,
         donor_pays_minor, net_to_cause_minor, status, idempotency_key, provider, provider_reference, simulated
       ) VALUES ($1, $2, 'anonymous', 10000, 0, 0, 0, 10000, 10000, 'pending', $3, 'daraja-sandbox', $4, false)`,
      [donor, requestId, randomUUID(), `daraja_${randomUUID().replaceAll("-", "")}`],
    )).rejects.toThrow(/sandbox mock provider/i);
    await owner.query("ROLLBACK TO SAVEPOINT trigger_attempt");

    await owner.query("SELECT set_config('jirani.profile_id', $1, true)", [donor]);
    await owner.query("SELECT set_config('jirani.roles', 'donor', true)");
    const begun = await owner.query(
      `SELECT jirani.begin_sandbox_payment($1, NULL, 10000, 'anonymous', NULL, $2, 'sandbox-mock') AS created`,
      [requestId, randomUUID()],
    );
    const mockReference = `sbx_${randomUUID().replaceAll("-", "")}`;
    await owner.query(`SELECT jirani.attach_sandbox_reference($1, $2)`, [begun.rows[0].created.id, mockReference]);
    const posted = await owner.query(
      `SELECT jirani.apply_sandbox_verification($1, $2, 'successful', 10000, 'KES') AS applied`,
      [mockReference, randomUUID().replaceAll("-", "")],
    );
    expect(posted.rows[0].applied.result).toBe("posted");

    const daraja = await owner.query("SELECT status, provider, contribution_id FROM sandbox_payments WHERE id = $1", [paymentId]);
    expect(daraja.rows[0].provider).toBe("daraja-sandbox");
    expect(daraja.rows[0].contribution_id).toBeNull();
    const contributions = await owner.query(
      `SELECT provider, count(*) AS n FROM contributions WHERE request_id = $1 GROUP BY provider`,
      [requestId],
    );
    expect(contributions.rows).toEqual([{ provider: "sandbox-mock", n: "1" }]);
    const ledger = await owner.query(
      `SELECT count(*) AS n FROM ledger_entries e
       JOIN contributions c ON c.id = e.contribution_id
       WHERE c.request_id = $1 AND c.provider = 'daraja-sandbox'`,
      [requestId],
    );
    expect(Number(ledger.rows[0].n)).toBe(0);
    const refunds = await owner.query(
      `SELECT count(*) AS n FROM refunds r
       JOIN contributions c ON c.id = r.contribution_id
       WHERE c.request_id = $1 AND c.provider = 'daraja-sandbox'`,
      [requestId],
    );
    expect(Number(refunds.rows[0].n)).toBe(0);
  });
});

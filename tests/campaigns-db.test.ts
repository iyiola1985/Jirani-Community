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

describeLive("monthly community campaigns", () => {
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

  async function save(admin: string, slug: string, starts: Date, ends: Date, cancellation: boolean) {
    await asUser(admin, "administrator");
    const result = await client.query(
      `SELECT jirani.save_campaign(
         NULL, 'School fees in Kisumu', $1, 'school', $2, 500000, $3, $4, 'Kisumu',
         'Households in Kisumu', $5, $6, $7, $8, $9, $10, NULL
       ) AS id`,
      [slug, objective, starts.toISOString(), ends.toISOString(), eligibility, selection, fee, refund, surplus, cancellation],
    );
    return result.rows[0].id as string;
  }

  it("validates drafts and keeps them off the public page", async () => {
    await client.query("BEGIN");
    const admin = await register("recipient");
    const donor = await register("donor");
    const slug = `school-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await asUser(donor, "donor");
    await expectRaise(
      `SELECT jirani.save_campaign(NULL, 'School fees in Kisumu', $1, 'school', $2, 500000, now(), now() + interval '10 days', 'Kisumu', 'Households in Kisumu', $3, $4, $5, $6, $7, false, NULL)`,
      [slug, objective, eligibility, selection, fee, refund, surplus],
      /administrator/i,
    );
    await asUser(admin, "administrator");
    await expectRaise(
      `SELECT jirani.save_campaign(NULL, 'Short', $1, 'school', $2, 500000, now(), now() + interval '10 days', 'Kisumu', 'Households in Kisumu', $3, $4, $5, $6, $7, false, NULL)`,
      [slug, objective, eligibility, selection, fee, refund, surplus],
      /title/i,
    );
    await expectRaise(
      `SELECT jirani.save_campaign(NULL, 'School fees in Kisumu', $1, 'school', $2, -100, now(), now() + interval '10 days', 'Kisumu', 'Households in Kisumu', $3, $4, $5, $6, $7, false, NULL)`,
      [slug, objective, eligibility, selection, fee, refund, surplus],
      /shillings/i,
    );
    await expectRaise(
      `SELECT jirani.save_campaign(NULL, 'School fees in Kisumu', $1, 'school', $2, 500000, now() + interval '10 days', now(), 'Kisumu', 'Households in Kisumu', $3, $4, $5, $6, $7, false, NULL)`,
      [slug, objective, eligibility, selection, fee, refund, surplus],
      /closing date/i,
    );
    const id = await save(admin, slug, new Date(Date.now() - 86_400_000), new Date(Date.now() + 20 * 86_400_000), false);
    await expectRaise(
      `INSERT INTO campaigns (title, slug, category, objective, target_amount_minor, starts_at, ends_at, county, beneficiary_group, eligibility_criteria, beneficiary_selection_rules, fee_disclosure, refund_policy, surplus_policy, status, created_by)
       VALUES ('Another campaign', 'another-campaign', 'food', $1, 500000, now(), now() + interval '1 day', 'Nairobi', 'Neighbours nearby', $2, $3, $4, $5, $6, 'draft', $7)`,
      [objective, eligibility, selection, fee, refund, surplus, admin],
      /permission denied/i,
    );
    await asUser("", "");
    const hidden = await client.query("SELECT id FROM campaigns WHERE id = $1", [id]);
    expect(hidden.rowCount).toBe(0);
    await asUser(admin, "administrator");
    const visible = await client.query("SELECT status FROM campaigns WHERE id = $1", [id]);
    expect(visible.rows[0].status).toBe("draft");
  });

  it("opens an active campaign, counts one simulated gift, and reconciles without paying", async () => {
    await client.query("BEGIN");
    const admin = await register("recipient");
    const donor = await register("donor");
    const slug = `school-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const future = `later-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const activeId = await save(admin, slug, new Date(Date.now() - 86_400_000), new Date(Date.now() + 20 * 86_400_000), false);
    const scheduledId = await save(admin, future, new Date(Date.now() + 5 * 86_400_000), new Date(Date.now() + 20 * 86_400_000), false);
    await asUser(donor, "donor");
    await expectRaise(
      `SELECT jirani.record_simulated_campaign_contribution($1, 10000, 'anonymous', NULL, $2)`,
      [activeId, randomUUID()],
      /active campaigns/i,
    );
    await asUser(admin, "administrator");
    await client.query(`SELECT jirani.transition_campaign($1, 'under_review', 'Ready for a second look.')`, [activeId]);
    await client.query(`SELECT jirani.transition_campaign($1, 'approved', 'Rules and disclosures are complete.')`, [activeId]);
    await expectRaise(
      `SELECT jirani.transition_campaign($1, 'scheduled', 'The opening date has passed.')`,
      [activeId],
      /already opened/i,
    );
    await client.query(`SELECT jirani.transition_campaign($1, 'active', 'The campaign is inside its dates.')`, [activeId]);
    await client.query(`SELECT jirani.transition_campaign($1, 'under_review', 'Ready for a second look.')`, [scheduledId]);
    await client.query(`SELECT jirani.transition_campaign($1, 'approved', 'Rules and disclosures are complete.')`, [scheduledId]);
    await client.query(`SELECT jirani.transition_campaign($1, 'scheduled', 'It opens on the published date.')`, [scheduledId]);
    await asUser(donor, "donor");
    await expectRaise(
      `SELECT jirani.record_simulated_campaign_contribution($1, 10000, 'anonymous', NULL, $2)`,
      [scheduledId, randomUUID()],
      /not started/i,
    );
    const key = randomUUID();
    const started = await client.query(
      `SELECT jirani.record_simulated_campaign_contribution($1, 10000, 'anonymous', NULL, $2) AS created`,
      [activeId, key],
    );
    const contributionId = started.rows[0].created.id as string;
    expect(started.rows[0].created.duplicate).toBe(false);
    const again = await client.query(
      `SELECT jirani.record_simulated_campaign_contribution($1, 10000, 'anonymous', NULL, $2) AS created`,
      [activeId, key],
    );
    expect(again.rows[0].created).toMatchObject({ id: contributionId, duplicate: true });
    const pending = await client.query("SELECT jirani.raised_for_campaign($1) AS raised", [activeId]);
    expect(Number(pending.rows[0].raised)).toBe(0);
    const rows = await client.query("SELECT count(*) AS n FROM contributions WHERE campaign_id = $1", [activeId]);
    expect(Number(rows.rows[0].n)).toBe(1);
    await client.query(`SELECT jirani.settle_simulated_contribution($1, 'successful', $2)`, [contributionId, randomUUID()]);
    await client.query(`SELECT jirani.settle_simulated_contribution($1, 'successful', $2)`, [contributionId, randomUUID()]);
    const gifts = await client.query(
      "SELECT count(*) AS n FROM ledger_entries WHERE contribution_id = $1 AND entry_type = 'gift'",
      [contributionId],
    );
    expect(Number(gifts.rows[0].n)).toBe(1);
    const raised = await client.query("SELECT jirani.raised_for_campaign($1) AS raised", [activeId]);
    expect(Number(raised.rows[0].raised)).toBe(10_000);
    const history = await client.query("SELECT request_id, campaign_id FROM jirani.donor_contributions($1)", [contributionId]);
    expect(history.rows[0].request_id).toBeNull();
    expect(history.rows[0].campaign_id).toBe(activeId);
    await asUser(admin, "administrator");
    await client.query(
      `SELECT jirani.record_campaign_selection($1, 'Review file Kisumu households', 'One reviewed household group in Kisumu was selected.', 10000)`,
      [activeId],
    );
    await expectRaise(
      `SELECT jirani.record_campaign_selection($1, 'Review file Kisumu households', 'A different group was preferred later.', 10000)`,
      [activeId],
      /cannot be rerun/i,
    );
    await client.query(
      `SELECT jirani.record_simulated_reversal($1, 5000, 'Partial demonstration reversal.', $2)`,
      [contributionId, randomUUID()],
    );
    const afterReversal = await client.query(
      "SELECT jirani.raised_for_campaign($1) AS raised, jirani.campaign_contribution_count($1) AS gifts",
      [activeId],
    );
    expect(Number(afterReversal.rows[0].raised)).toBe(5_000);
    expect(Number(afterReversal.rows[0].gifts)).toBe(1);
    await client.query(`SELECT jirani.transition_campaign($1, 'closed', 'The campaign has stopped taking gifts.')`, [activeId]);
    const kept = await client.query("SELECT count(*) AS n FROM contributions WHERE id = $1", [contributionId]);
    expect(Number(kept.rows[0].n)).toBe(1);
    await asUser(donor, "donor");
    await expectRaise(
      `SELECT jirani.record_simulated_campaign_contribution($1, 10000, 'anonymous', NULL, $2)`,
      [activeId, randomUUID()],
      /closed to new gifts/i,
    );
    await asUser(admin, "administrator");
    await client.query(
      `SELECT jirani.transition_campaign($1, 'reconciling', 'Checked the ledger. No unresolved gift remains.')`,
      [activeId],
    );
    const reconciliation = await client.query(
      "SELECT net_minor, funds_sent, surplus_note FROM campaign_reconciliations WHERE campaign_id = $1",
      [activeId],
    );
    expect(Number(reconciliation.rows[0].net_minor)).toBe(5_000);
    expect(reconciliation.rows[0].funds_sent).toBe(false);
    expect(reconciliation.rows[0].surplus_note).toBe(surplus);
    await expectRaise(
      `SELECT jirani.publish_campaign_report($1, $2)`,
      [activeId, "Email the organiser at desk@example.com before saying the bill was paid today."],
      /phone number, email/i,
    );
    await client.query(
      `SELECT jirani.publish_campaign_report($1, $2)`,
      [activeId, "A simulated gift was recorded and partly reversed. An allocation decision was written down. No payment has been sent."],
    );
    await asUser("", "");
    const report = await client.query("SELECT * FROM jirani.public_campaign_report($1)", [activeId]);
    expect(Number(report.rows[0].raised_minor)).toBe(5_000);
    expect(Number(report.rows[0].allocated_minor)).toBe(10_000);
    expect(Number(report.rows[0].paid_minor)).toBe(0);
    const privateSelection = await client.query("SELECT id FROM campaign_selections WHERE campaign_id = $1", [activeId]);
    expect(privateSelection.rowCount).toBe(0);
    const publicRow = await client.query("SELECT objective FROM campaigns WHERE id = $1", [activeId]);
    expect(publicRow.rows[0].objective).toContain("Kisumu");
  });

  it("enforces the published cancellation policy", async () => {
    await client.query("BEGIN");
    const admin = await register("recipient");
    const locked = await save(
      admin,
      `locked-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 20 * 86_400_000),
      false,
    );
    const open = await save(
      admin,
      `open-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 20 * 86_400_000),
      true,
    );
    for (const id of [locked, open]) {
      await client.query(`SELECT jirani.transition_campaign($1, 'under_review', 'Ready for a second look.')`, [id]);
      await client.query(`SELECT jirani.transition_campaign($1, 'approved', 'Rules and disclosures are complete.')`, [id]);
      await client.query(`SELECT jirani.transition_campaign($1, 'active', 'The campaign is inside its dates.')`, [id]);
    }
    await expectRaise(
      `SELECT jirani.transition_campaign($1, 'cancelled', 'Trying to cancel against the policy.')`,
      [locked],
      /does not allow cancellation/i,
    );
    await client.query(`SELECT jirani.transition_campaign($1, 'cancelled', 'The published policy allows this stop.')`, [open]);
    const donor = await register("donor");
    await asUser(donor, "donor");
    await expectRaise(
      `SELECT jirani.record_simulated_campaign_contribution($1, 10000, 'anonymous', NULL, $2)`,
      [open, randomUUID()],
      /closed to new gifts/i,
    );
    const stillThere = await client.query("SELECT status FROM campaigns WHERE id = $1", [locked]);
    expect(stillThere.rows[0].status).toBe("active");
  });

  it("still records a simulated gift on a published assistance request", async () => {
    await client.query("BEGIN");
    const recipient = await register("recipient");
    const donor = await register("donor");
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
    await asUser(donor, "donor");
    const started = await client.query(
      `SELECT jirani.record_simulated_contribution($1, 10000, 'anonymous', NULL, $2) AS created`,
      [requestId, randomUUID()],
    );
    await client.query(`SELECT jirani.settle_simulated_contribution($1, 'successful', $2)`, [
      started.rows[0].created.id,
      randomUUID(),
    ]);
    const raised = await client.query("SELECT jirani.raised_for_request($1) AS raised", [requestId]);
    expect(Number(raised.rows[0].raised)).toBe(10_000);
    const own = await client.query("SELECT request_id, campaign_id FROM jirani.donor_contributions(NULL)");
    expect(own.rows[0].request_id).toBe(requestId);
    expect(own.rows[0].campaign_id).toBeNull();
  });
});

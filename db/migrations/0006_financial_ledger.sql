-- Persistent simulated gifts for published requests.
-- Amounts are integer cents: 100 minor units = KES 1. Display code divides by 100.
-- No floating-point amounts are stored.
--
-- Accounting rule:
--   The total for a request is the sum of ledger_entries.amount_minor
--   for contributions whose status is successful.
--   A gift row is positive and is written only when a simulated contribution
--   becomes successful. Pending and failed contributions have no gift row.
--   A reversal adds a negative refund row. It does not change the gift row
--   or the contribution amount columns.
--   The same contribution idempotency key returns the original row.
--   The same reversal idempotency key returns the original refund.
--   Two callers with one new key: the unique index makes the second wait.
--   After the first commits, the second is returned the same contribution.
--   Closing a request does not delete these rows.

ALTER TABLE contributions
  ADD COLUMN settled_at timestamptz;

COMMENT ON COLUMN contributions.gift_minor IS
  'Integer cents. 100 = KES 1. This demonstration stores the gift with no fee deducted.';
COMMENT ON COLUMN contributions.provider_reference IS
  'Unique demonstration reference. It is not an M-Pesa receipt.';
COMMENT ON COLUMN contributions.settled_at IS
  'Set once when the simulated provider reports success or failure.';

CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id uuid NOT NULL REFERENCES contributions (id),
  refund_id uuid REFERENCES refunds (id),
  entry_type text NOT NULL CHECK (entry_type IN ('gift', 'refund', 'adjustment')),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  actor_id uuid,
  reason text NOT NULL CHECK (char_length(reason) >= 8),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_gift_positive CHECK (entry_type <> 'gift' OR amount_minor > 0),
  CONSTRAINT ledger_refund_negative CHECK (entry_type <> 'refund' OR amount_minor < 0),
  CONSTRAINT ledger_refund_link CHECK (
    (entry_type = 'refund' AND refund_id IS NOT NULL)
    OR (entry_type <> 'refund' AND refund_id IS NULL)
  )
);

CREATE UNIQUE INDEX ledger_one_gift_per_contribution
  ON ledger_entries (contribution_id)
  WHERE entry_type = 'gift';
CREATE INDEX ledger_entries_contribution_idx ON ledger_entries (contribution_id, created_at);
CREATE INDEX ledger_entries_created_idx ON ledger_entries (created_at DESC);

CREATE FUNCTION jirani.reject_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger entries are append-only';
END;
$$;

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION jirani.reject_ledger_mutation();

CREATE FUNCTION jirani.require_ledger_writer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('jirani.trusted_ledger_write', true) IS DISTINCT FROM 'on'
     OR NOT jirani.trusted_writer() THEN
    RAISE EXCEPTION 'financial rows are posted by the ledger functions';
  END IF;
  IF TG_TABLE_NAME = 'contributions' AND TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'a contribution starts as pending';
    END IF;
    IF NEW.simulated IS NOT TRUE OR NEW.provider IS DISTINCT FROM 'mock' THEN
      RAISE EXCEPTION 'only a simulated mock contribution can be posted here';
    END IF;
    IF NEW.collected_platform_fee_minor <> 0
       OR NEW.campaign_borne_fee_minor <> 0
       OR NEW.provider_fee_minor <> 0
       OR NEW.donor_pays_minor <> NEW.gift_minor
       OR NEW.net_to_cause_minor <> NEW.gift_minor THEN
      RAISE EXCEPTION 'this demonstration records the gift without a fee deduction';
    END IF;
    IF NEW.gift_minor < 10000 OR NEW.gift_minor > 200000000 OR NEW.gift_minor % 100 <> 0 THEN
      RAISE EXCEPTION 'enter a whole number of shillings from KES 100 to KES 2000000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contributions_ledger_insert
  BEFORE INSERT ON contributions
  FOR EACH ROW EXECUTE FUNCTION jirani.require_ledger_writer();
CREATE TRIGGER payment_events_ledger_insert
  BEFORE INSERT ON payment_events
  FOR EACH ROW EXECUTE FUNCTION jirani.require_ledger_writer();
CREATE TRIGGER refunds_ledger_insert
  BEFORE INSERT ON refunds
  FOR EACH ROW EXECUTE FUNCTION jirani.require_ledger_writer();
CREATE TRIGGER receipts_ledger_insert
  BEFORE INSERT ON receipts
  FOR EACH ROW EXECUTE FUNCTION jirani.require_ledger_writer();
CREATE TRIGGER ledger_entries_ledger_insert
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION jirani.require_ledger_writer();

CREATE OR REPLACE FUNCTION jirani.protect_contribution() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'contributions cannot be deleted';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.settled_at IS DISTINCT FROM OLD.settled_at THEN
    IF current_setting('jirani.trusted_ledger_write', true) IS DISTINCT FROM 'on'
       OR NOT jirani.trusted_writer() THEN
      RAISE EXCEPTION 'contribution status changes go through the ledger';
    END IF;
  END IF;
  IF NEW.settled_at IS DISTINCT FROM OLD.settled_at
     AND OLD.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'settled time is written once';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.donor_profile_id IS DISTINCT FROM OLD.donor_profile_id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.recognition IS DISTINCT FROM OLD.recognition
     OR NEW.public_name IS DISTINCT FROM OLD.public_name
     OR NEW.gift_minor IS DISTINCT FROM OLD.gift_minor
     OR NEW.collected_platform_fee_minor IS DISTINCT FROM OLD.collected_platform_fee_minor
     OR NEW.campaign_borne_fee_minor IS DISTINCT FROM OLD.campaign_borne_fee_minor
     OR NEW.provider_fee_minor IS DISTINCT FROM OLD.provider_fee_minor
     OR NEW.donor_pays_minor IS DISTINCT FROM OLD.donor_pays_minor
     OR NEW.net_to_cause_minor IS DISTINCT FROM OLD.net_to_cause_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_reference IS DISTINCT FROM OLD.provider_reference
     OR NEW.simulated IS DISTINCT FROM OLD.simulated THEN
    RAISE EXCEPTION 'contribution financial fields are immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    OLD.status = 'pending' AND NEW.status IN ('successful', 'failed')
  ) THEN
    RAISE EXCEPTION 'illegal contribution status transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION jirani.raised_for_request(target uuid) RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(e.amount_minor), 0)
  FROM ledger_entries e
  JOIN contributions c ON c.id = e.contribution_id
  WHERE c.request_id = target
    AND c.status = 'successful'
    AND e.entry_type IN ('gift', 'refund', 'adjustment')
$$;

CREATE OR REPLACE FUNCTION jirani.raised_for_published(target uuid) RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM assistance_requests
      WHERE id = target AND status IN ('published', 'closed', 'suspended')
    ) THEN jirani.raised_for_request(target)
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION jirani.record_simulated_contribution(
  target_request uuid,
  gift_minor bigint,
  next_recognition recognition,
  next_public_name text,
  next_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  donor uuid := jirani.profile_id();
  request_status request_status;
  recipient uuid;
  existing_id uuid;
  existing_gift bigint;
  existing_donor uuid;
  existing_reference text;
  existing_status payment_status;
  created_id uuid;
  reference text;
  shown_name text;
BEGIN
  IF donor IS NULL THEN
    RAISE EXCEPTION 'only a donor account can record a contribution';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_roles WHERE profile_id = donor AND role = 'donor'
  ) THEN
    RAISE EXCEPTION 'only a donor account can record a contribution';
  END IF;
  IF gift_minor IS NULL OR gift_minor < 10000 OR gift_minor > 200000000 OR gift_minor % 100 <> 0 THEN
    RAISE EXCEPTION 'enter a whole number of shillings from KES 100 to KES 2000000';
  END IF;
  IF next_idempotency_key IS NULL OR char_length(next_idempotency_key) < 8 OR char_length(next_idempotency_key) > 80 THEN
    RAISE EXCEPTION 'that idempotency key was already used';
  END IF;
  IF next_public_name IS NOT NULL AND (
    next_public_name ~ '@' OR next_public_name ~ '[0-9]{6,}'
  ) THEN
    RAISE EXCEPTION 'a public name cannot include a phone number or email';
  END IF;

  SELECT status, recipient_profile_id
    INTO request_status, recipient
  FROM assistance_requests
  WHERE id = target_request
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contributions are open on published requests';
  END IF;
  IF request_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'contributions are open on published requests';
  END IF;
  IF recipient = donor THEN
    RAISE EXCEPTION 'you cannot contribute to your own request';
  END IF;

  SELECT id, contributions.gift_minor, donor_profile_id, provider_reference, status
    INTO existing_id, existing_gift, existing_donor, existing_reference, existing_status
  FROM contributions
  WHERE idempotency_key = next_idempotency_key;
  IF FOUND THEN
    IF existing_donor IS DISTINCT FROM donor OR existing_gift IS DISTINCT FROM gift_minor THEN
      RAISE EXCEPTION 'that idempotency key was already used';
    END IF;
    RETURN jsonb_build_object(
      'id', existing_id,
      'providerReference', existing_reference,
      'status', existing_status,
      'duplicate', true
    );
  END IF;

  shown_name := NULL;
  IF next_recognition = 'public' THEN
    shown_name := NULLIF(left(btrim(coalesce(next_public_name, '')), 80), '');
    IF shown_name IS NULL THEN
      SELECT display_name INTO shown_name FROM profiles WHERE id = donor;
    END IF;
  END IF;

  reference := 'sim_' || replace(gen_random_uuid()::text, '-', '');
  PERFORM set_config('jirani.trusted_ledger_write', 'on', true);
  INSERT INTO contributions (
    donor_profile_id, request_id, recognition, public_name,
    gift_minor, collected_platform_fee_minor, campaign_borne_fee_minor, provider_fee_minor,
    donor_pays_minor, net_to_cause_minor, currency, status,
    idempotency_key, provider, provider_reference, simulated
  ) VALUES (
    donor, target_request, next_recognition, shown_name,
    gift_minor, 0, 0, 0,
    gift_minor, gift_minor, 'KES', 'pending',
    next_idempotency_key, 'mock', reference, true
  ) RETURNING id INTO created_id;
  PERFORM set_config('jirani.trusted_ledger_write', 'off', true);
  PERFORM jirani.write_audit(
    donor,
    'contribution.started',
    'contribution',
    created_id,
    'Simulated contribution started. No money has moved.',
    jsonb_build_object('requestId', target_request, 'giftMinor', gift_minor)
  );
  RETURN jsonb_build_object(
    'id', created_id,
    'providerReference', reference,
    'status', 'pending',
    'duplicate', false
  );
EXCEPTION
  WHEN unique_violation THEN
    PERFORM set_config('jirani.trusted_ledger_write', 'off', true);
    SELECT id, contributions.gift_minor, donor_profile_id, provider_reference, status
      INTO existing_id, existing_gift, existing_donor, existing_reference, existing_status
    FROM contributions
    WHERE idempotency_key = next_idempotency_key;
    IF existing_donor IS DISTINCT FROM donor OR existing_gift IS DISTINCT FROM gift_minor THEN
      RAISE EXCEPTION 'that idempotency key was already used';
    END IF;
    RETURN jsonb_build_object(
      'id', existing_id,
      'providerReference', existing_reference,
      'status', existing_status,
      'duplicate', true
    );
END;
$$;

CREATE OR REPLACE FUNCTION jirani.settle_simulated_contribution(
  target_contribution uuid,
  outcome payment_status,
  provider_event_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  donor uuid := jirani.profile_id();
  current_status payment_status;
  current_donor uuid;
  current_net bigint;
  current_simulated boolean;
  current_provider text;
  receipt text;
BEGIN
  IF donor IS NULL THEN
    RAISE EXCEPTION 'only the donor can confirm this simulation';
  END IF;
  IF outcome IS NULL OR outcome NOT IN ('successful', 'failed') THEN
    RAISE EXCEPTION 'the simulator can report success or failure';
  END IF;
  IF provider_event_id IS NULL OR char_length(provider_event_id) < 8 THEN
    RAISE EXCEPTION 'the simulator can report success or failure';
  END IF;

  SELECT status, donor_profile_id, net_to_cause_minor, simulated, provider
    INTO current_status, current_donor, current_net, current_simulated, current_provider
  FROM contributions
  WHERE id = target_contribution
  FOR UPDATE;
  IF NOT FOUND OR current_donor IS DISTINCT FROM donor THEN
    RAISE EXCEPTION 'only the donor can confirm this simulation';
  END IF;
  IF current_simulated IS NOT TRUE OR current_provider IS DISTINCT FROM 'mock' THEN
    RAISE EXCEPTION 'only a simulated mock contribution can be posted here';
  END IF;
  IF current_status IS DISTINCT FROM 'pending' THEN
    IF current_status IS DISTINCT FROM outcome THEN
      RAISE EXCEPTION 'this simulated contribution is already settled';
    END IF;
    SELECT receipt_number INTO receipt FROM receipts WHERE contribution_id = target_contribution;
    RETURN jsonb_build_object('status', current_status, 'duplicate', true, 'receiptNumber', receipt);
  END IF;

  PERFORM set_config('jirani.trusted_ledger_write', 'on', true);
  UPDATE contributions
  SET status = outcome, settled_at = now()
  WHERE id = target_contribution;
  INSERT INTO payment_events (contribution_id, provider_event_id, outcome, verified_status)
  VALUES (target_contribution, provider_event_id, 'accepted', outcome);
  receipt := NULL;
  IF outcome = 'successful' THEN
    receipt := 'SIM-' || upper(substr(replace(target_contribution::text, '-', ''), 1, 12));
    INSERT INTO receipts (contribution_id, receipt_number, simulated)
    VALUES (target_contribution, receipt, true);
    INSERT INTO ledger_entries (contribution_id, entry_type, amount_minor, actor_id, reason)
    VALUES (
      target_contribution,
      'gift',
      current_net,
      donor,
      'Simulated gift recorded. No money moved.'
    );
  END IF;
  PERFORM set_config('jirani.trusted_ledger_write', 'off', true);
  PERFORM jirani.write_audit(
    donor,
    'payment.' || outcome,
    'contribution',
    target_contribution,
    'Status recorded from the simulated provider, not from a browser redirect.',
    jsonb_build_object('providerEventId', provider_event_id)
  );
  RETURN jsonb_build_object('status', outcome, 'duplicate', false, 'receiptNumber', receipt);
END;
$$;

CREATE OR REPLACE FUNCTION jirani.record_simulated_reversal(
  target_contribution uuid,
  reversal_minor bigint,
  reversal_reason text,
  next_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := jirani.profile_id();
  current_status payment_status;
  current_net bigint;
  current_simulated boolean;
  recipient uuid;
  already bigint;
  existing_id uuid;
  existing_amount bigint;
  created_id uuid;
BEGIN
  IF actor IS NULL OR NOT jirani.is_admin() THEN
    RAISE EXCEPTION 'only an administrator can record a reversal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = actor) THEN
    RAISE EXCEPTION 'this administrator profile is not registered in the database';
  END IF;
  IF char_length(coalesce(reversal_reason, '')) < 8 THEN
    RAISE EXCEPTION 'record a reason of at least 8 characters';
  END IF;
  IF reversal_minor IS NULL OR reversal_minor <= 0 OR reversal_minor % 100 <> 0 THEN
    RAISE EXCEPTION 'enter a whole number of shillings from KES 100 to KES 2000000';
  END IF;
  IF next_idempotency_key IS NULL OR char_length(next_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'that idempotency key was already used';
  END IF;

  SELECT c.status, c.net_to_cause_minor, c.simulated, r.recipient_profile_id
    INTO current_status, current_net, current_simulated, recipient
  FROM contributions c
  JOIN assistance_requests r ON r.id = c.request_id
  WHERE c.id = target_contribution
  FOR UPDATE;
  IF NOT FOUND OR current_simulated IS NOT TRUE THEN
    RAISE EXCEPTION 'only a successful simulated contribution can be reversed';
  END IF;
  IF actor = recipient THEN
    RAISE EXCEPTION 'you cannot reverse a contribution on your own request';
  END IF;
  IF current_status IS DISTINCT FROM 'successful' THEN
    RAISE EXCEPTION 'only a successful simulated contribution can be reversed';
  END IF;

  SELECT id, amount_minor
    INTO existing_id, existing_amount
  FROM refunds
  WHERE idempotency_key = next_idempotency_key;
  IF FOUND THEN
    IF existing_amount IS DISTINCT FROM reversal_minor THEN
      RAISE EXCEPTION 'that idempotency key was already used';
    END IF;
    RETURN jsonb_build_object('refundId', existing_id, 'duplicate', true);
  END IF;

  SELECT coalesce(sum(-amount_minor), 0)
    INTO already
  FROM ledger_entries
  WHERE contribution_id = target_contribution AND entry_type = 'refund';
  IF already + reversal_minor > current_net THEN
    RAISE EXCEPTION 'the reversal is larger than the amount recorded for the cause';
  END IF;

  PERFORM set_config('jirani.trusted_ledger_write', 'on', true);
  INSERT INTO refunds (
    contribution_id, amount_minor, currency, reason, idempotency_key, approved_by, simulated
  ) VALUES (
    target_contribution, reversal_minor, 'KES', reversal_reason, next_idempotency_key, actor, true
  ) RETURNING id INTO created_id;
  INSERT INTO ledger_entries (
    contribution_id, refund_id, entry_type, amount_minor, actor_id, reason
  ) VALUES (
    target_contribution, created_id, 'refund', -reversal_minor, actor, reversal_reason
  );
  PERFORM set_config('jirani.trusted_ledger_write', 'off', true);
  PERFORM jirani.write_audit(
    actor,
    'payment.refunded',
    'contribution',
    target_contribution,
    reversal_reason,
    jsonb_build_object('refundId', created_id, 'amountMinor', reversal_minor)
  );
  RETURN jsonb_build_object('refundId', created_id, 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION jirani.public_acknowledgements(target uuid)
RETURNS TABLE (display_name text, gift_minor bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT shown_name, remaining_minor
  FROM (
    SELECT
      CASE
        WHEN c.recognition = 'public' THEN coalesce(c.public_name, 'A neighbour')
        ELSE 'Anonymous'
      END AS shown_name,
      c.net_to_cause_minor + coalesce((
        SELECT sum(e.amount_minor)
        FROM ledger_entries e
        WHERE e.contribution_id = c.id AND e.entry_type IN ('refund', 'adjustment')
      ), 0) AS remaining_minor,
      c.settled_at,
      c.created_at
    FROM contributions c
    JOIN assistance_requests r ON r.id = c.request_id
    WHERE c.request_id = target
      AND r.status = 'published'
      AND c.status = 'successful'
      AND c.simulated = true
  ) gifts
  WHERE remaining_minor > 0
  ORDER BY settled_at NULLS LAST, created_at
$$;

CREATE OR REPLACE FUNCTION jirani.donor_contributions(target uuid)
RETURNS TABLE (
  id uuid,
  request_id uuid,
  request_title text,
  gift_minor bigint,
  net_to_cause_minor bigint,
  status payment_status,
  provider_reference text,
  recognition recognition,
  public_name text,
  created_at timestamptz,
  settled_at timestamptz,
  receipt_number text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.request_id,
    r.title,
    c.gift_minor,
    c.net_to_cause_minor,
    c.status,
    c.provider_reference,
    c.recognition,
    c.public_name,
    c.created_at,
    c.settled_at,
    receipts.receipt_number
  FROM contributions c
  JOIN assistance_requests r ON r.id = c.request_id
  LEFT JOIN receipts ON receipts.contribution_id = c.id
  WHERE c.donor_profile_id = jirani.profile_id()
    AND (target IS NULL OR c.id = target)
  ORDER BY c.created_at DESC
$$;

REVOKE ALL ON FUNCTION jirani.reject_ledger_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.require_ledger_writer() FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.raised_for_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.record_simulated_contribution(uuid, bigint, recognition, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.settle_simulated_contribution(uuid, payment_status, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.record_simulated_reversal(uuid, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.public_acknowledgements(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.donor_contributions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jirani.raised_for_request(uuid) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.record_simulated_contribution(uuid, bigint, recognition, text, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.settle_simulated_contribution(uuid, payment_status, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.record_simulated_reversal(uuid, bigint, text, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.public_acknowledgements(uuid) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.donor_contributions(uuid) TO jirani_app;

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_select ON ledger_entries FOR SELECT
  USING (
    jirani.is_admin()
    OR EXISTS (
      SELECT 1 FROM contributions c
      WHERE c.id = contribution_id AND jirani.is_self(c.donor_profile_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE ON contributions FROM jirani_app;
REVOKE INSERT, UPDATE, DELETE ON payment_events FROM jirani_app;
REVOKE INSERT, UPDATE, DELETE ON refunds FROM jirani_app;
REVOKE INSERT, UPDATE, DELETE ON receipts FROM jirani_app;
REVOKE INSERT, UPDATE, DELETE ON provider_verifications FROM jirani_app;
GRANT SELECT ON ledger_entries TO jirani_app;

COMMENT ON TABLE ledger_entries IS
  'Append-only. A mistake is a new refund or adjustment row. Ordinary updates and deletes are rejected.';
COMMENT ON FUNCTION jirani.raised_for_request(uuid) IS
  'Sum of successful gift, refund, and adjustment rows. Closing the request does not change this sum.';

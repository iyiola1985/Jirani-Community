-- Sandbox payment attempts are not contributions.
-- A gift ledger row is written only after a verified successful result,
-- and only while the request is still published or the campaign is still open.
-- A verified result that arrives after the target closes is kept for investigation
-- and does not increase the public total.
-- Provider fees stay null until a provider reports one. Null means not yet reconciled.
-- jirani_app still cannot insert ledger rows itself. The new GUC is set only
-- inside these security-definer functions.

CREATE TYPE sandbox_payment_status AS ENUM (
  'created', 'pending', 'successful', 'failed', 'cancelled', 'quarantined'
);

CREATE TABLE sandbox_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_profile_id uuid NOT NULL REFERENCES profiles (id),
  request_id uuid REFERENCES assistance_requests (id),
  campaign_id uuid REFERENCES campaigns (id),
  gift_minor bigint NOT NULL CHECK (
    gift_minor >= 10000 AND gift_minor <= 200000000 AND gift_minor % 100 = 0
  ),
  currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  provider text NOT NULL CHECK (provider IN ('sandbox-mock', 'daraja-sandbox')),
  provider_reference text UNIQUE,
  internal_reference text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  status sandbox_payment_status NOT NULL DEFAULT 'created',
  provider_fee_minor bigint CHECK (provider_fee_minor IS NULL OR provider_fee_minor >= 0),
  contribution_id uuid UNIQUE REFERENCES contributions (id),
  recognition recognition NOT NULL,
  public_name text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  CONSTRAINT sandbox_payments_one_target CHECK (
    (request_id IS NOT NULL AND campaign_id IS NULL)
    OR (request_id IS NULL AND campaign_id IS NOT NULL)
  )
);

CREATE INDEX sandbox_payments_queue_idx ON sandbox_payments (status, created_at DESC);
CREATE INDEX sandbox_payments_donor_idx ON sandbox_payments (donor_profile_id, created_at DESC);

CREATE TABLE sandbox_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_payment_id uuid REFERENCES sandbox_payments (id),
  provider_event_id text NOT NULL UNIQUE,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'duplicate', 'rejected', 'quarantined')),
  detail text NOT NULL CHECK (char_length(detail) BETWEEN 4 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION jirani.reject_sandbox_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sandbox payment events are append-only';
END;
$$;

CREATE TRIGGER sandbox_payment_events_append_only
  BEFORE UPDATE OR DELETE ON sandbox_payment_events
  FOR EACH ROW EXECUTE FUNCTION jirani.reject_sandbox_event_mutation();

CREATE FUNCTION jirani.require_sandbox_writer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('jirani.trusted_sandbox_write', true) IS DISTINCT FROM 'on'
     OR NOT jirani.trusted_writer() THEN
    RAISE EXCEPTION 'sandbox payments are posted by the sandbox functions';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sandbox_payments_writer
  BEFORE INSERT OR UPDATE OR DELETE ON sandbox_payments
  FOR EACH ROW EXECUTE FUNCTION jirani.require_sandbox_writer();
CREATE TRIGGER sandbox_payment_events_writer
  BEFORE INSERT ON sandbox_payment_events
  FOR EACH ROW EXECUTE FUNCTION jirani.require_sandbox_writer();

ALTER TABLE refunds ALTER COLUMN approved_by DROP NOT NULL;
ALTER TABLE refunds ADD COLUMN provider_event_id text UNIQUE;
ALTER TABLE refunds ADD CONSTRAINT refunds_has_approver_or_provider CHECK (
  approved_by IS NOT NULL OR provider_event_id IS NOT NULL
);

CREATE OR REPLACE FUNCTION jirani.require_ledger_writer() RETURNS trigger
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
    IF current_setting('jirani.trusted_verified_payment', true) = 'on' THEN
      IF NOT (
        (NEW.provider = 'sandbox-mock' AND NEW.simulated IS TRUE)
        OR (NEW.provider = 'daraja-sandbox' AND NEW.simulated IS FALSE)
      ) THEN
        RAISE EXCEPTION 'verified posting only accepts a sandbox provider';
      END IF;
    ELSIF NEW.simulated IS NOT TRUE OR NEW.provider IS DISTINCT FROM 'mock' THEN
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

CREATE OR REPLACE FUNCTION jirani.begin_sandbox_payment(
  target_request uuid,
  target_campaign uuid,
  gift_minor bigint,
  next_recognition recognition,
  next_public_name text,
  next_idempotency_key text,
  next_provider text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  donor uuid := jirani.profile_id();
  existing_id uuid;
  existing_donor uuid;
  existing_gift bigint;
  existing_reference text;
  existing_status sandbox_payment_status;
  created_id uuid;
  internal_reference text;
  shown_name text;
  recipient uuid;
  campaign_status campaign_status;
  opens timestamptz;
  closes timestamptz;
BEGIN
  IF donor IS NULL OR NOT EXISTS (
    SELECT 1 FROM user_roles WHERE profile_id = donor AND role = 'donor'
  ) THEN
    RAISE EXCEPTION 'only a donor account can start a sandbox payment';
  END IF;
  IF (target_request IS NULL) = (target_campaign IS NULL) THEN
    RAISE EXCEPTION 'a payment must name one request or one campaign';
  END IF;
  IF next_provider IS DISTINCT FROM 'sandbox-mock' THEN
    RAISE EXCEPTION 'sandbox payments are not configured';
  END IF;
  IF gift_minor IS NULL OR gift_minor < 10000 OR gift_minor > 200000000 OR gift_minor % 100 <> 0 THEN
    RAISE EXCEPTION 'enter a whole number of shillings from KES 100 to KES 2000000';
  END IF;
  IF next_idempotency_key IS NULL OR char_length(next_idempotency_key) < 8 OR char_length(next_idempotency_key) > 80 THEN
    RAISE EXCEPTION 'that idempotency key was already used';
  END IF;
  IF next_public_name IS NOT NULL AND (next_public_name ~ '@' OR next_public_name ~ '[0-9]{6,}') THEN
    RAISE EXCEPTION 'a public name cannot include a phone number or email';
  END IF;

  SELECT id, donor_profile_id, sandbox_payments.gift_minor, sandbox_payments.internal_reference, status
    INTO existing_id, existing_donor, existing_gift, existing_reference, existing_status
  FROM sandbox_payments WHERE idempotency_key = next_idempotency_key;
  IF FOUND THEN
    IF existing_donor IS DISTINCT FROM donor OR existing_gift IS DISTINCT FROM gift_minor THEN
      RAISE EXCEPTION 'that idempotency key was already used';
    END IF;
    RETURN jsonb_build_object(
      'id', existing_id, 'internalReference', existing_reference, 'status', existing_status, 'duplicate', true
    );
  END IF;

  IF target_request IS NOT NULL THEN
    SELECT recipient_profile_id INTO recipient
    FROM assistance_requests
    WHERE id = target_request AND status = 'published'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'sandbox payments are open on published requests';
    END IF;
    IF recipient = donor THEN
      RAISE EXCEPTION 'you cannot pay toward your own request';
    END IF;
  ELSE
    SELECT status, starts_at, ends_at INTO campaign_status, opens, closes
    FROM campaigns WHERE id = target_campaign FOR UPDATE;
    IF NOT FOUND OR campaign_status IS DISTINCT FROM 'active' OR opens > now() OR closes <= now() THEN
      RAISE EXCEPTION 'sandbox payments are open on active campaigns';
    END IF;
  END IF;

  shown_name := NULL;
  IF next_recognition = 'public' THEN
    shown_name := NULLIF(left(btrim(coalesce(next_public_name, '')), 80), '');
    IF shown_name IS NULL THEN
      SELECT display_name INTO shown_name FROM profiles WHERE id = donor;
    END IF;
  END IF;

  created_id := gen_random_uuid();
  internal_reference := 'pay_' || substr(replace(created_id::text, '-', ''), 1, 20);
  PERFORM set_config('jirani.trusted_sandbox_write', 'on', true);
  INSERT INTO sandbox_payments (
    id, donor_profile_id, request_id, campaign_id, gift_minor, provider,
    internal_reference, idempotency_key, status, recognition, public_name
  ) VALUES (
    created_id, donor, target_request, target_campaign, gift_minor, next_provider,
    internal_reference, next_idempotency_key, 'created', next_recognition, shown_name
  );
  PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
  PERFORM jirani.write_audit(
    donor, 'sandbox.created', 'sandbox_payment', created_id,
    'Sandbox payment created. It is not a contribution and no total has changed.',
    jsonb_build_object('giftMinor', gift_minor)
  );
  RETURN jsonb_build_object(
    'id', created_id, 'internalReference', internal_reference, 'status', 'created', 'duplicate', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION jirani.attach_sandbox_reference(
  target uuid,
  next_provider_reference text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  donor uuid := jirani.profile_id();
  owner uuid;
  current_status sandbox_payment_status;
BEGIN
  IF next_provider_reference IS NULL OR next_provider_reference !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION 'the provider reference could not be stored';
  END IF;
  SELECT donor_profile_id, status INTO owner, current_status
  FROM sandbox_payments WHERE id = target FOR UPDATE;
  IF NOT FOUND OR owner IS DISTINCT FROM donor THEN
    RAISE EXCEPTION 'that sandbox payment does not exist';
  END IF;
  IF current_status IS DISTINCT FROM 'created' THEN
    RETURN jsonb_build_object('id', target, 'status', current_status, 'duplicate', true);
  END IF;
  PERFORM set_config('jirani.trusted_sandbox_write', 'on', true);
  UPDATE sandbox_payments
  SET provider_reference = next_provider_reference, status = 'pending', updated_at = now()
  WHERE id = target;
  PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
  RETURN jsonb_build_object('id', target, 'status', 'pending', 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION jirani.fail_sandbox_initiation(target uuid, reason text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  donor uuid := jirani.profile_id();
  owner uuid;
  current_status sandbox_payment_status;
BEGIN
  SELECT donor_profile_id, status INTO owner, current_status
  FROM sandbox_payments WHERE id = target FOR UPDATE;
  IF NOT FOUND OR owner IS DISTINCT FROM donor THEN
    RAISE EXCEPTION 'that sandbox payment does not exist';
  END IF;
  IF current_status IS DISTINCT FROM 'created' THEN
    RETURN;
  END IF;
  PERFORM set_config('jirani.trusted_sandbox_write', 'on', true);
  UPDATE sandbox_payments
  SET status = 'failed', last_error = left(coalesce(reason, 'The provider did not start the payment.'), 500), updated_at = now()
  WHERE id = target;
  PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION jirani.apply_sandbox_verification(
  next_provider_reference text,
  next_event_id text,
  next_outcome text,
  next_amount bigint,
  next_currency text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payment sandbox_payments%ROWTYPE;
  eligible boolean := false;
  recipient uuid;
  campaign_status campaign_status;
  opens timestamptz;
  closes timestamptz;
  created_contribution uuid;
  receipt text;
  already bigint;
  created_refund uuid;
BEGIN
  IF next_event_id IS NULL OR next_event_id !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    RAISE EXCEPTION 'that provider event cannot be recorded';
  END IF;
  IF next_outcome NOT IN ('successful', 'failed', 'cancelled', 'reversed') OR next_currency IS DISTINCT FROM 'KES' THEN
    RAISE EXCEPTION 'that provider event cannot be recorded';
  END IF;
  IF EXISTS (SELECT 1 FROM sandbox_payment_events WHERE provider_event_id = next_event_id) THEN
    RETURN jsonb_build_object('result', 'duplicate');
  END IF;

  SELECT * INTO payment FROM sandbox_payments WHERE provider_reference = next_provider_reference FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM set_config('jirani.trusted_sandbox_write', 'on', true);
    INSERT INTO sandbox_payment_events (provider_event_id, outcome, detail)
    VALUES (next_event_id, 'rejected', 'Unknown provider reference.');
    PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
    RETURN jsonb_build_object('result', 'unknown');
  END IF;
  PERFORM set_config('jirani.trusted_sandbox_write', 'on', true);

  IF next_amount IS DISTINCT FROM payment.gift_minor OR next_currency IS DISTINCT FROM payment.currency THEN
    INSERT INTO sandbox_payment_events (sandbox_payment_id, provider_event_id, outcome, detail)
    VALUES (payment.id, next_event_id, 'quarantined', 'Amount or currency did not match the payment.');
    IF payment.status = 'pending' THEN
      UPDATE sandbox_payments
      SET status = 'quarantined', last_error = 'Amount or currency did not match.', updated_at = now()
      WHERE id = payment.id;
    END IF;
    PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
    RETURN jsonb_build_object('result', 'quarantined', 'id', payment.id);
  END IF;

  IF payment.status = 'successful' AND next_outcome IN ('failed', 'cancelled') THEN
    INSERT INTO sandbox_payment_events (sandbox_payment_id, provider_event_id, outcome, detail)
    VALUES (payment.id, next_event_id, 'rejected', 'A later failure did not replace a verified success.');
    PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
    RETURN jsonb_build_object('result', 'kept-success', 'id', payment.id, 'contributionId', payment.contribution_id);
  END IF;

  IF payment.status = 'successful' AND next_outcome = 'successful' THEN
    INSERT INTO sandbox_payment_events (sandbox_payment_id, provider_event_id, outcome, detail)
    VALUES (payment.id, next_event_id, 'duplicate', 'Successful payment was already posted.');
    PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
    RETURN jsonb_build_object('result', 'duplicate', 'id', payment.id, 'contributionId', payment.contribution_id);
  END IF;

  IF next_outcome = 'reversed' THEN
    IF payment.contribution_id IS NULL OR payment.status IS DISTINCT FROM 'successful' THEN
      INSERT INTO sandbox_payment_events (sandbox_payment_id, provider_event_id, outcome, detail)
      VALUES (payment.id, next_event_id, 'rejected', 'A reversal needs a posted successful payment.');
      PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
      RETURN jsonb_build_object('result', 'rejected', 'id', payment.id);
    END IF;
    SELECT coalesce(sum(-amount_minor), 0) INTO already
    FROM ledger_entries WHERE contribution_id = payment.contribution_id AND entry_type = 'refund';
    IF already + next_amount > payment.gift_minor THEN
      INSERT INTO sandbox_payment_events (sandbox_payment_id, provider_event_id, outcome, detail)
      VALUES (payment.id, next_event_id, 'rejected', 'The reversal is larger than the posted gift.');
      PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
      RETURN jsonb_build_object('result', 'rejected', 'id', payment.id);
    END IF;
    PERFORM set_config('jirani.trusted_ledger_write', 'on', true);
    INSERT INTO refunds (
      contribution_id, amount_minor, currency, reason, idempotency_key, approved_by, provider_event_id, simulated
    ) VALUES (
      payment.contribution_id, next_amount, 'KES',
      'Verified sandbox reversal. The original gift stays in the ledger.',
      'sandbox-reversal-' || next_event_id, NULL, next_event_id,
      payment.provider = 'sandbox-mock'
    ) RETURNING id INTO created_refund;
    INSERT INTO ledger_entries (contribution_id, refund_id, entry_type, amount_minor, actor_id, reason)
    VALUES (
      payment.contribution_id, created_refund, 'refund', -next_amount, payment.donor_profile_id,
      'Verified sandbox reversal. No payout was sent.'
    );
    PERFORM set_config('jirani.trusted_ledger_write', 'off', true);
    INSERT INTO sandbox_payment_events (sandbox_payment_id, provider_event_id, outcome, detail)
    VALUES (payment.id, next_event_id, 'accepted', 'Verified reversal posted as a new ledger row.');
    UPDATE sandbox_payments SET updated_at = now() WHERE id = payment.id;
    PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
    RETURN jsonb_build_object('result', 'reversed', 'id', payment.id, 'contributionId', payment.contribution_id);
  END IF;

  IF payment.status IS DISTINCT FROM 'pending' THEN
    INSERT INTO sandbox_payment_events (sandbox_payment_id, provider_event_id, outcome, detail)
    VALUES (payment.id, next_event_id, 'rejected', 'The payment is not pending.');
    PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
    RETURN jsonb_build_object('result', 'rejected', 'id', payment.id);
  END IF;

  IF next_outcome IN ('failed', 'cancelled') THEN
    UPDATE sandbox_payments
    SET status = next_outcome::sandbox_payment_status, verified_at = now(), updated_at = now()
    WHERE id = payment.id;
    INSERT INTO sandbox_payment_events (sandbox_payment_id, provider_event_id, outcome, detail)
    VALUES (payment.id, next_event_id, 'accepted', 'Provider reported ' || next_outcome || '. No gift was posted.');
    PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
    RETURN jsonb_build_object('result', next_outcome, 'id', payment.id);
  END IF;

  IF payment.request_id IS NOT NULL THEN
    SELECT recipient_profile_id INTO recipient
    FROM assistance_requests
    WHERE id = payment.request_id AND status = 'published'
    FOR UPDATE;
    eligible := FOUND AND recipient IS DISTINCT FROM payment.donor_profile_id;
  ELSE
    SELECT status, starts_at, ends_at INTO campaign_status, opens, closes
    FROM campaigns WHERE id = payment.campaign_id FOR UPDATE;
    eligible := FOUND AND campaign_status = 'active' AND opens <= now() AND closes > now();
  END IF;

  IF NOT eligible THEN
    UPDATE sandbox_payments
    SET status = 'quarantined',
        last_error = 'Verified after the target stopped accepting gifts. Nothing was posted.',
        verified_at = now(),
        updated_at = now()
    WHERE id = payment.id;
    INSERT INTO sandbox_payment_events (sandbox_payment_id, provider_event_id, outcome, detail)
    VALUES (payment.id, next_event_id, 'quarantined', 'Verified after the target closed. No gift was posted.');
    PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
    RETURN jsonb_build_object('result', 'quarantined', 'id', payment.id);
  END IF;

  PERFORM set_config('jirani.trusted_ledger_write', 'on', true);
  PERFORM set_config('jirani.trusted_verified_payment', 'on', true);
  INSERT INTO contributions (
    donor_profile_id, request_id, campaign_id, recognition, public_name,
    gift_minor, collected_platform_fee_minor, campaign_borne_fee_minor, provider_fee_minor,
    donor_pays_minor, net_to_cause_minor, currency, status,
    idempotency_key, provider, provider_reference, simulated
  ) VALUES (
    payment.donor_profile_id, payment.request_id, payment.campaign_id, payment.recognition, payment.public_name,
    payment.gift_minor, 0, 0, 0,
    payment.gift_minor, payment.gift_minor, 'KES', 'pending',
    'sandbox-' || payment.id::text, payment.provider, payment.provider_reference, payment.provider = 'sandbox-mock'
  ) RETURNING id INTO created_contribution;
  UPDATE contributions SET status = 'successful', settled_at = now() WHERE id = created_contribution;
  receipt := 'SBX-' || upper(substr(replace(created_contribution::text, '-', ''), 1, 12));
  INSERT INTO receipts (contribution_id, receipt_number, simulated)
  VALUES (created_contribution, receipt, payment.provider = 'sandbox-mock');
  INSERT INTO ledger_entries (contribution_id, entry_type, amount_minor, actor_id, reason)
  VALUES (
    created_contribution, 'gift', payment.gift_minor, payment.donor_profile_id,
    'Verified sandbox gift. This is not a payout and the provider fee is not yet reconciled.'
  );
  INSERT INTO payment_events (contribution_id, provider_event_id, outcome, verified_status)
  VALUES (created_contribution, next_event_id, 'accepted', 'successful');
  PERFORM set_config('jirani.trusted_verified_payment', 'off', true);
  PERFORM set_config('jirani.trusted_ledger_write', 'off', true);

  UPDATE sandbox_payments
  SET status = 'successful', contribution_id = created_contribution, verified_at = now(), updated_at = now()
  WHERE id = payment.id;
  INSERT INTO sandbox_payment_events (sandbox_payment_id, provider_event_id, outcome, detail)
  VALUES (payment.id, next_event_id, 'accepted', 'Verified success posted once.');
  PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);
  PERFORM set_config('jirani.profile_id', payment.donor_profile_id::text, true);
  PERFORM jirani.write_audit(
    payment.donor_profile_id, 'sandbox.posted', 'contribution', created_contribution,
    'Verified sandbox gift posted once. No payout was sent.',
    jsonb_build_object('sandboxPaymentId', payment.id)
  );
  RETURN jsonb_build_object(
    'result', 'posted', 'id', payment.id, 'contributionId', created_contribution, 'receiptNumber', receipt
  );
EXCEPTION
  WHEN unique_violation THEN
    IF EXISTS (SELECT 1 FROM sandbox_payment_events WHERE provider_event_id = next_event_id)
       OR EXISTS (
         SELECT 1 FROM sandbox_payments
         WHERE provider_reference = next_provider_reference AND contribution_id IS NOT NULL
       ) THEN
      RETURN jsonb_build_object('result', 'duplicate');
    END IF;
    RAISE;
END;
$$;

ALTER TABLE sandbox_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE sandbox_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_payment_events FORCE ROW LEVEL SECURITY;

CREATE POLICY sandbox_payments_select ON sandbox_payments FOR SELECT
  USING (jirani.is_admin() OR jirani.is_self(donor_profile_id));
CREATE POLICY sandbox_events_select ON sandbox_payment_events FOR SELECT
  USING (
    jirani.is_admin()
    OR EXISTS (
      SELECT 1 FROM sandbox_payments p
      WHERE p.id = sandbox_payment_id AND jirani.is_self(p.donor_profile_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE ON sandbox_payments FROM jirani_app;
REVOKE ALL ON sandbox_payment_events FROM jirani_app;
GRANT SELECT ON sandbox_payments, sandbox_payment_events TO jirani_app;

REVOKE ALL ON FUNCTION jirani.begin_sandbox_payment(uuid, uuid, bigint, recognition, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.attach_sandbox_reference(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.fail_sandbox_initiation(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.apply_sandbox_verification(text, text, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jirani.begin_sandbox_payment(uuid, uuid, bigint, recognition, text, text, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.attach_sandbox_reference(uuid, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.fail_sandbox_initiation(uuid, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.apply_sandbox_verification(text, text, text, bigint, text) TO jirani_app;

COMMENT ON TABLE sandbox_payments IS
  'A sandbox attempt. Public totals change only after apply_sandbox_verification posts a successful contribution. provider_fee_minor null means the fee is not yet reconciled.';
COMMENT ON FUNCTION jirani.require_ledger_writer() IS
  'Ordinary inserts stay limited to pending mock gifts. trusted_verified_payment allows one pending sandbox row from the sandbox function, still not from jirani_app directly.';

-- Close the Daraja posting path.
-- STK Query does not return the amount paid, and Transaction Status has not
-- been established as evidence for an STK receipt. jirani_app can already call
-- apply_sandbox_verification, and that function would post a gift for a
-- daraja-sandbox row. This migration refuses that provider before any
-- contribution, refund, or ledger write. The mock sandbox path is unchanged.
-- No new privilege is granted.

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
      -- daraja-sandbox is intentionally absent. A later migration may allow it
      -- only after a separate authoritative verification decision.
      IF NOT (NEW.provider = 'sandbox-mock' AND NEW.simulated IS TRUE) THEN
        RAISE EXCEPTION 'verified posting only accepts a sandbox mock provider';
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

  -- Untrusted Daraja data must not change a contribution or a ledger row.
  IF payment.provider IS DISTINCT FROM 'sandbox-mock' THEN
    RETURN jsonb_build_object('result', 'disabled', 'id', payment.id);
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

COMMENT ON FUNCTION jirani.require_ledger_writer() IS
  'Ordinary inserts stay limited to pending mock gifts. A verified sandbox insert accepts only sandbox-mock. daraja-sandbox cannot post until an authoritative verification decision exists.';

COMMENT ON FUNCTION jirani.apply_sandbox_verification(text, text, text, bigint, text) IS
  'Posts one sandbox-mock gift after verification. A daraja-sandbox row returns disabled and does not change a contribution or ledger entry. STK Query does not provide the amount, and Transaction Status support for an STK receipt is not established.';

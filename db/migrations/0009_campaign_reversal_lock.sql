-- Replace the reversal function applied in 0008.
-- PostgreSQL cannot lock the nullable side of an outer join, so the contribution
-- is locked first and the assistance request is locked only when the gift has one.

-- A reversal may now belong to a request or a campaign.
-- The self-dealing check still applies when the gift is on a request.
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
  request_target uuid;
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

  SELECT c.status, c.net_to_cause_minor, c.simulated, c.request_id
    INTO current_status, current_net, current_simulated, request_target
  FROM contributions c
  WHERE c.id = target_contribution
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'only a successful simulated contribution can be reversed';
  END IF;
  IF request_target IS NOT NULL THEN
    SELECT recipient_profile_id INTO recipient
    FROM assistance_requests
    WHERE id = request_target
    FOR UPDATE;
  END IF;
  IF current_simulated IS NOT TRUE THEN
    RAISE EXCEPTION 'only a successful simulated contribution can be reversed';
  END IF;
  IF recipient IS NOT NULL AND actor = recipient THEN
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

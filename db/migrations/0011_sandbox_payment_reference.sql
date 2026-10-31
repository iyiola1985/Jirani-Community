-- Qualify internal_reference. The PL/pgSQL variable has the same name as the column.

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

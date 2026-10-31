-- Close an account without deleting gifts, receipts, or ledger rows.
-- The profile row stays so those foreign keys remain valid.
-- Email, phone, display name, private notes, and the password hash are removed.
-- A public gift name is cleared. The amount is not.

ALTER TABLE contributions
  ADD COLUMN IF NOT EXISTS public_name_retired boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contributions.public_name_retired IS
  'True after the donor closes the account. The gift amount stays. The public page shows Anonymous.';

CREATE OR REPLACE FUNCTION jirani.protect_profile_privileges() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profile id cannot be changed';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email AND (
    current_setting('jirani.trusted_profile_write', true) IS DISTINCT FROM 'on'
    OR NOT jirani.trusted_writer()
  ) THEN
    RAISE EXCEPTION 'profile id and email are changed through the authentication provider';
  END IF;
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN
    NEW.phone_verification_status := 'not_started';
  END IF;
  IF NEW.account_status IS DISTINCT FROM OLD.account_status
     AND (
       current_setting('jirani.trusted_profile_write', true) IS DISTINCT FROM 'on'
       OR NOT jirani.trusted_writer()
     ) THEN
    RAISE EXCEPTION 'account status can only be changed by an authorised administrator operation';
  END IF;
  IF NEW.phone_verification_status IS DISTINCT FROM OLD.phone_verification_status
     AND (
       current_setting('jirani.trusted_profile_write', true) IS DISTINCT FROM 'on'
       OR NOT jirani.trusted_writer()
     )
     AND NOT (OLD.phone IS DISTINCT FROM NEW.phone AND NEW.phone_verification_status = 'not_started') THEN
    RAISE EXCEPTION 'phone verification status cannot be set from a profile edit';
  END IF;
  RETURN NEW;
END;
$$;

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
  IF NEW.public_name IS DISTINCT FROM OLD.public_name AND NOT (
    current_setting('jirani.trusted_profile_write', true) = 'on'
    AND jirani.trusted_writer()
    AND NEW.public_name IS NULL
  ) THEN
    RAISE EXCEPTION 'contribution financial fields are immutable';
  END IF;
  IF NEW.public_name_retired IS DISTINCT FROM OLD.public_name_retired AND (
    current_setting('jirani.trusted_profile_write', true) IS DISTINCT FROM 'on'
    OR NOT jirani.trusted_writer()
  ) THEN
    RAISE EXCEPTION 'a public name is withdrawn only when the account is closed';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.donor_profile_id IS DISTINCT FROM OLD.donor_profile_id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.recognition IS DISTINCT FROM OLD.recognition
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
        WHEN c.recognition = 'public' AND c.public_name_retired IS NOT TRUE
          THEN coalesce(c.public_name, 'A neighbour')
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

CREATE OR REPLACE FUNCTION jirani.public_campaign_acknowledgements(target uuid)
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
        WHEN c.recognition = 'public' AND c.public_name_retired IS NOT TRUE
          THEN coalesce(c.public_name, 'A neighbour')
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
    JOIN campaigns camp ON camp.id = c.campaign_id
    WHERE c.campaign_id = target
      AND camp.status IN ('active', 'closed', 'reconciling', 'reported')
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
  campaign_id uuid,
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
    c.campaign_id,
    coalesce(r.title, camp.title),
    c.gift_minor,
    c.net_to_cause_minor,
    c.status,
    c.provider_reference,
    c.recognition,
    CASE WHEN c.public_name_retired THEN NULL ELSE c.public_name END,
    c.created_at,
    c.settled_at,
    receipts.receipt_number
  FROM contributions c
  LEFT JOIN assistance_requests r ON r.id = c.request_id
  LEFT JOIN campaigns camp ON camp.id = c.campaign_id
  LEFT JOIN receipts ON receipts.contribution_id = c.id
  WHERE c.donor_profile_id = jirani.profile_id()
    AND (target IS NULL OR c.id = target)
  ORDER BY c.created_at DESC
$$;

CREATE OR REPLACE FUNCTION jirani.password_hash_for_session(actor uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.password_hash
  FROM auth_credentials c
  JOIN profiles p ON p.id = c.profile_id
  WHERE c.profile_id = actor
    AND p.id = jirani.profile_id()
    AND p.account_status = 'active'
$$;

CREATE OR REPLACE FUNCTION jirani.replace_password(actor uuid, next_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM jirani.profile_id() THEN
    RAISE EXCEPTION 'only the signed-in account can change its password';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = actor AND account_status = 'active') THEN
    RAISE EXCEPTION 'a closed account cannot change its password';
  END IF;
  IF next_hash !~ '^scrypt:[0-9a-f]+:[0-9a-f]+$' THEN
    RAISE EXCEPTION 'password hash is not in the expected form';
  END IF;
  UPDATE auth_credentials SET password_hash = next_hash WHERE profile_id = actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this account has no database password';
  END IF;
  PERFORM jirani.write_audit(actor, 'account.password_changed', 'profile', actor, 'Password replaced by the holder.', '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION jirani.close_account(actor uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  keys text[];
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM jirani.profile_id() THEN
    RAISE EXCEPTION 'only the signed-in account can close itself';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = actor AND account_status = 'active') THEN
    RAISE EXCEPTION 'that account is already closed';
  END IF;
  IF EXISTS (SELECT 1 FROM user_roles WHERE profile_id = actor AND role = 'administrator')
     AND (
       SELECT count(DISTINCT ur.profile_id)
       FROM user_roles ur
       JOIN profiles p ON p.id = ur.profile_id
       WHERE ur.role = 'administrator' AND p.account_status = 'active'
     ) <= 1 THEN
    RAISE EXCEPTION 'the last administrator account stays open';
  END IF;

  PERFORM set_config('jirani.trusted_profile_write', 'on', true);
  UPDATE profiles
  SET account_status = 'closed',
      email = 'closed-' || replace(actor::text, '-', '') || '@accounts.invalid',
      phone = NULL,
      county = NULL,
      display_name = 'Closed account',
      public_display_name = 'Closed account',
      suspended_at = coalesce(suspended_at, now())
  WHERE id = actor;

  DELETE FROM auth_credentials WHERE profile_id = actor;

  PERFORM set_config('jirani.profile_id', '', true);
  UPDATE recipient_verifications
  SET legal_name = 'Closed account',
      id_document_reference = NULL,
      review_notes = NULL
  WHERE profile_id = actor;
  PERFORM set_config('jirani.profile_id', actor::text, true);

  UPDATE assistance_request_private AS private
  SET situation_notes = '',
      reason = '',
      applicant_feedback = ''
  FROM assistance_requests AS request
  WHERE private.request_id = request.id
    AND request.recipient_profile_id = actor;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'assistance_request_private'
      AND column_name = 'evidence_gap'
  ) THEN
    EXECUTE $gap$
      UPDATE assistance_request_private AS private
      SET evidence_gap = ''
      FROM assistance_requests AS request
      WHERE private.request_id = request.id
        AND request.recipient_profile_id = $1
    $gap$ USING actor;
  END IF;

  PERFORM set_config('jirani.trusted_profile_write', 'on', true);
  UPDATE contributions
  SET public_name = NULL,
      public_name_retired = true
  WHERE donor_profile_id = actor
    AND (public_name IS NOT NULL OR public_name_retired IS NOT TRUE);

  PERFORM set_config('jirani.trusted_sandbox_write', 'on', true);
  UPDATE sandbox_payments
  SET public_name = NULL
  WHERE donor_profile_id = actor
    AND public_name IS NOT NULL;
  PERFORM set_config('jirani.trusted_sandbox_write', 'off', true);

  SELECT coalesce(array_agg(storage_key), ARRAY[]::text[])
  INTO keys
  FROM private_evidence_metadata AS evidence
  JOIN assistance_requests AS request ON request.id = evidence.request_id
  WHERE evidence.owner_profile_id = actor
    AND request.recipient_profile_id = actor
    AND storage_key ~ '^[0-9a-f-]{36}\.(pdf|jpg|png|webp|mp4|webm)$';

  DELETE FROM private_evidence_metadata AS evidence
  USING assistance_requests AS request
  WHERE evidence.request_id = request.id
    AND evidence.owner_profile_id = actor
    AND request.recipient_profile_id = actor;

  UPDATE consent_records
  SET consent_status = 'withdrawn',
      withdrawn_at = coalesce(withdrawn_at, now())
  WHERE profile_id = actor
    AND consent_status = 'granted';

  PERFORM jirani.write_audit(
    actor,
    'account.closed',
    'profile',
    actor,
    'Account closed by the holder.',
    '{}'::jsonb
  );
  RETURN keys;
END;
$$;

REVOKE ALL ON FUNCTION jirani.password_hash_for_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.replace_password(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.close_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jirani.password_hash_for_session(uuid) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.replace_password(uuid, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.close_account(uuid) TO jirani_app;

COMMENT ON FUNCTION jirani.close_account(uuid) IS
  'Closes the signed-in account. Gifts and ledger rows stay. Personal fields, the password hash, and the holder''s private request files are removed. The last active administrator cannot close.';

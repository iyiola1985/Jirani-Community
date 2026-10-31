-- Assistance request details, private evidence rules, and status history.
-- Applicants insert drafts. Only another administrator can verify, publish, reject, or close.

ALTER TABLE assistance_requests
  ADD COLUMN IF NOT EXISTS urgent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locality text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS preferred_assistance text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_token uuid;

ALTER TABLE assistance_requests DROP CONSTRAINT IF EXISTS assistance_requests_locality_check;
ALTER TABLE assistance_requests
  ADD CONSTRAINT assistance_requests_locality_check CHECK (char_length(locality) <= 80);

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'assistance_requests'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%category%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE assistance_requests DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE assistance_requests
  ADD CONSTRAINT assistance_requests_category_check CHECK (category IN (
    'food', 'rent', 'electricity', 'cooking_gas', 'internet', 'school', 'school_supplies',
    'medical', 'medication', 'surgery', 'maternity', 'funeral', 'clothing', 'hygiene', 'transport', 'other'
  ));

ALTER TABLE assistance_requests DROP CONSTRAINT IF EXISTS assistance_requests_preferred_check;
ALTER TABLE assistance_requests
  ADD CONSTRAINT assistance_requests_preferred_check CHECK (
    preferred_assistance = '' OR preferred_assistance IN (
      'food', 'rent', 'electricity', 'cooking_gas', 'internet', 'school', 'school_supplies',
      'medical', 'medication', 'surgery', 'maternity', 'funeral', 'clothing', 'hygiene', 'transport', 'other'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS assistance_requests_client_token_idx
  ON assistance_requests (client_token) WHERE client_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS assistance_requests_queue_idx
  ON assistance_requests (status, category, county, created_at DESC);

ALTER TABLE assistance_request_private
  ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS applicant_feedback text NOT NULL DEFAULT '';

ALTER TABLE private_evidence_metadata DROP CONSTRAINT IF EXISTS private_evidence_metadata_type_check;
ALTER TABLE private_evidence_metadata
  ADD CONSTRAINT private_evidence_metadata_type_check CHECK (
    content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  );

ALTER TABLE private_evidence_metadata DROP CONSTRAINT IF EXISTS private_evidence_metadata_key_check;
ALTER TABLE private_evidence_metadata
  ADD CONSTRAINT private_evidence_metadata_key_check CHECK (
    storage_key IS NULL OR storage_key ~ '^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'
  );

ALTER TABLE private_evidence_metadata DROP CONSTRAINT IF EXISTS private_evidence_metadata_name_check;
ALTER TABLE private_evidence_metadata
  ADD CONSTRAINT private_evidence_metadata_name_check CHECK (
    char_length(file_name) BETWEEN 1 AND 80 AND file_name !~ '[\\/]'
  );

CREATE TABLE IF NOT EXISTS request_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES assistance_requests (id) ON DELETE CASCADE,
  from_status request_status,
  to_status request_status NOT NULL,
  actor_id uuid,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS request_status_events_request_idx
  ON request_status_events (request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS request_review_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES assistance_requests (id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 8 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS request_review_notes_request_idx
  ON request_review_notes (request_id, created_at DESC);

CREATE OR REPLACE FUNCTION jirani.enforce_request_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor uuid := jirani.profile_id();
  owner_step boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION 'new requests start as draft or submitted';
    END IF;
    IF actor IS NULL OR actor <> NEW.recipient_profile_id THEN
      RAISE EXCEPTION 'only the recipient can create their request';
    END IF;
    IF NEW.demo THEN
      RAISE EXCEPTION 'an applicant cannot mark a request as demonstration data';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.recipient_profile_id IS DISTINCT FROM OLD.recipient_profile_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.demo IS DISTINCT FROM OLD.demo
     OR NEW.client_token IS DISTINCT FROM OLD.client_token THEN
    RAISE EXCEPTION 'request identity fields are immutable';
  END IF;

  IF actor = OLD.recipient_profile_id AND OLD.status NOT IN ('draft', 'needs_information') THEN
    IF NEW.title IS DISTINCT FROM OLD.title
       OR NEW.public_summary IS DISTINCT FROM OLD.public_summary
       OR NEW.public_alias IS DISTINCT FROM OLD.public_alias
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.county IS DISTINCT FROM OLD.county
       OR NEW.urgent IS DISTINCT FROM OLD.urgent
       OR NEW.locality IS DISTINCT FROM OLD.locality
       OR NEW.preferred_assistance IS DISTINCT FROM OLD.preferred_assistance
       OR NEW.amount_needed_minor IS DISTINCT FROM OLD.amount_needed_minor THEN
      RAISE EXCEPTION 'public request details are locked after submission';
    END IF;
  END IF;

  IF NEW.amount_needed_minor IS DISTINCT FROM OLD.amount_needed_minor
     AND OLD.status NOT IN ('draft', 'needs_information') THEN
    RAISE EXCEPTION 'the requested amount is locked after submission';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  owner_step := OLD.status IN ('draft', 'needs_information') AND NEW.status = 'submitted';
  IF owner_step THEN
    IF actor IS DISTINCT FROM OLD.recipient_profile_id THEN
      RAISE EXCEPTION 'only the recipient can submit this request';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT jirani.is_admin() OR actor IS NOT DISTINCT FROM OLD.recipient_profile_id THEN
    RAISE EXCEPTION 'only another administrator can make that decision';
  END IF;

  IF NEW.status = 'verified' AND NOT EXISTS (
    SELECT 1 FROM recipient_verifications
    WHERE profile_id = NEW.recipient_profile_id AND status = 'verified'
  ) THEN
    RAISE EXCEPTION 'verify the recipient before verifying this request';
  END IF;

  IF NOT (
    (OLD.status = 'submitted' AND NEW.status = 'under_review')
    OR (OLD.status = 'under_review' AND NEW.status IN ('verified', 'needs_information', 'rejected'))
    OR (OLD.status = 'verified' AND NEW.status = 'published')
    OR (OLD.status = 'rejected' AND NEW.status = 'under_review')
    OR (OLD.status = 'published' AND NEW.status IN ('closed', 'suspended'))
    OR (OLD.status = 'suspended' AND NEW.status = 'under_review')
  ) THEN
    RAISE EXCEPTION 'illegal request status transition from % to %', OLD.status, NEW.status;
  END IF;

  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at = now();
  END IF;
  IF NEW.status = 'closed' AND NEW.closed_at IS NULL THEN
    NEW.closed_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION jirani.record_request_status() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  INSERT INTO request_status_events (request_id, from_status, to_status, actor_id, reason)
  VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    jirani.profile_id(),
    left(coalesce(current_setting('jirani.status_reason', true), ''), 2000)
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS assistance_requests_history ON assistance_requests;
CREATE TRIGGER assistance_requests_history
  AFTER INSERT OR UPDATE OF status ON assistance_requests
  FOR EACH ROW EXECUTE FUNCTION jirani.record_request_status();

CREATE OR REPLACE FUNCTION jirani.reject_review_note_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'review notes are append-only';
END;
$$;

DROP TRIGGER IF EXISTS request_review_notes_append_only ON request_review_notes;
CREATE TRIGGER request_review_notes_append_only
  BEFORE UPDATE OR DELETE ON request_review_notes
  FOR EACH ROW EXECUTE FUNCTION jirani.reject_review_note_mutation();

DROP TRIGGER IF EXISTS request_status_events_append_only ON request_status_events;
CREATE TRIGGER request_status_events_append_only
  BEFORE UPDATE OR DELETE ON request_status_events
  FOR EACH ROW EXECUTE FUNCTION jirani.reject_review_note_mutation();

ALTER TABLE request_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_status_events FORCE ROW LEVEL SECURITY;
ALTER TABLE request_review_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_review_notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS status_events_select ON request_status_events;
CREATE POLICY status_events_select ON request_status_events FOR SELECT
  USING (
    jirani.is_admin()
    OR EXISTS (
      SELECT 1 FROM assistance_requests r
      WHERE r.id = request_id AND jirani.is_self(r.recipient_profile_id)
    )
  );

DROP POLICY IF EXISTS review_notes_select ON request_review_notes;
CREATE POLICY review_notes_select ON request_review_notes FOR SELECT
  USING (jirani.is_admin());
DROP POLICY IF EXISTS review_notes_insert ON request_review_notes;
CREATE POLICY review_notes_insert ON request_review_notes FOR INSERT
  WITH CHECK (jirani.is_admin() AND author_id = jirani.profile_id() AND author_id IS DISTINCT FROM (
    SELECT recipient_profile_id FROM assistance_requests WHERE id = request_id
  ));

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'consent_records'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%consent_type%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE consent_records DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE consent_records
  ADD CONSTRAINT consent_records_consent_type_check CHECK (consent_type IN (
    'terms', 'privacy', 'request_publication', 'verification', 'request_submission'
  ));

CREATE OR REPLACE FUNCTION jirani.decide_recipient_verification(
  target uuid,
  next_status verification_status,
  reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reviewer uuid;
  display text;
BEGIN
  IF NOT jirani.is_admin() OR jirani.profile_id() IS NULL OR jirani.profile_id() = target THEN
    RAISE EXCEPTION 'only another administrator can record that verification';
  END IF;
  IF char_length(coalesce(reason, '')) < 8 THEN
    RAISE EXCEPTION 'record a reason of at least 8 characters';
  END IF;
  IF next_status NOT IN ('under_review', 'verified', 'needs_information', 'rejected') THEN
    RAISE EXCEPTION 'that verification status cannot be recorded here';
  END IF;
  SELECT display_name INTO display FROM profiles WHERE id = target;
  IF display IS NULL THEN
    RAISE EXCEPTION 'that applicant does not have a profile';
  END IF;
  SELECT id INTO reviewer FROM profiles WHERE id = jirani.profile_id();
  INSERT INTO recipient_verifications (
    profile_id, legal_name, status, reviewer_id, review_reason, submitted_at, reviewed_at
  ) VALUES (
    target, display, next_status, reviewer, reason, now(), now()
  )
  ON CONFLICT (profile_id) DO UPDATE
  SET status = EXCLUDED.status,
      reviewer_id = EXCLUDED.reviewer_id,
      review_reason = EXCLUDED.review_reason,
      reviewed_at = now(),
      updated_at = now();
  PERFORM jirani.write_audit(
    jirani.profile_id(),
    'verification.decided',
    'recipient_verification',
    target,
    reason,
    jsonb_build_object('status', next_status)
  );
END;
$$;

CREATE OR REPLACE FUNCTION jirani.raised_for_published(target uuid) RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM assistance_requests WHERE id = target AND status = 'published'
    ) THEN 0
    ELSE GREATEST(
      0,
      coalesce((
        SELECT sum(c.net_to_cause_minor)
        FROM contributions c
        WHERE c.request_id = target AND c.status = 'successful'
      ), 0)
      - coalesce((
        SELECT sum(f.amount_minor)
        FROM refunds f
        JOIN contributions c ON c.id = f.contribution_id
        WHERE c.request_id = target AND c.status = 'successful'
      ), 0)
    )
  END
$$;

REVOKE ALL ON FUNCTION jirani.decide_recipient_verification(uuid, verification_status, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.raised_for_published(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jirani.decide_recipient_verification(uuid, verification_status, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.raised_for_published(uuid) TO jirani_app;

GRANT SELECT ON request_status_events TO jirani_app;
GRANT SELECT, INSERT ON request_review_notes TO jirani_app;
REVOKE INSERT, UPDATE, DELETE ON request_status_events FROM jirani_app;

CREATE OR REPLACE VIEW public_assistance_requests
WITH (security_barrier = true) AS
SELECT
  id,
  public_alias,
  category,
  title,
  public_summary,
  county,
  amount_needed_minor,
  currency,
  status,
  demo,
  published_at,
  urgent,
  locality
FROM assistance_requests
WHERE status = 'published';

COMMENT ON COLUMN private_evidence_metadata.storage_key IS
  'A file name inside the private storage directory. It is not a public URL.';
COMMENT ON TABLE request_review_notes IS
  'Administrators only. Applicants see applicant_feedback and status events, not these notes.';

-- Private evidence categories, review status, and campaign attachment.
-- Existing rows stay. File bytes stay on disk, not in a column.
-- No malware scanner and no video-duration tool are configured.
-- No retention interval is defined here. That is not a legal determination.
-- jirani_app does not gain a broad UPDATE or DELETE policy. Review and removal
-- go through security-definer functions. Applicants cannot mark their own files verified.

ALTER TABLE assistance_request_private
  ADD COLUMN IF NOT EXISTS evidence_gap text NOT NULL DEFAULT '';

ALTER TABLE assistance_request_private DROP CONSTRAINT IF EXISTS assistance_request_private_evidence_gap_check;
ALTER TABLE assistance_request_private
  ADD CONSTRAINT assistance_request_private_evidence_gap_check CHECK (char_length(evidence_gap) <= 500);

ALTER TABLE private_evidence_metadata
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other_supporting',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS review_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES profiles (id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'not_scanned',
  ADD COLUMN IF NOT EXISTS duration_measured boolean NOT NULL DEFAULT false;

ALTER TABLE private_evidence_metadata ALTER COLUMN request_id DROP NOT NULL;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'private_evidence_metadata'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%byte_size%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE private_evidence_metadata DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE private_evidence_metadata
  ADD CONSTRAINT private_evidence_metadata_byte_size_check
  CHECK (byte_size > 0 AND byte_size <= 52428800);

ALTER TABLE private_evidence_metadata DROP CONSTRAINT IF EXISTS private_evidence_metadata_type_check;
ALTER TABLE private_evidence_metadata
  ADD CONSTRAINT private_evidence_metadata_type_check CHECK (
    content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')
  );

ALTER TABLE private_evidence_metadata DROP CONSTRAINT IF EXISTS private_evidence_metadata_key_check;
ALTER TABLE private_evidence_metadata
  ADD CONSTRAINT private_evidence_metadata_key_check CHECK (
    storage_key IS NULL OR storage_key ~ '^[0-9a-f-]{36}\.(pdf|jpg|png|webp|mp4|webm)$'
  );

ALTER TABLE private_evidence_metadata DROP CONSTRAINT IF EXISTS private_evidence_metadata_parent_check;
ALTER TABLE private_evidence_metadata
  ADD CONSTRAINT private_evidence_metadata_parent_check CHECK (
    (request_id IS NOT NULL AND campaign_id IS NULL)
    OR (request_id IS NULL AND campaign_id IS NOT NULL)
  );

ALTER TABLE private_evidence_metadata DROP CONSTRAINT IF EXISTS private_evidence_metadata_category_check;
ALTER TABLE private_evidence_metadata
  ADD CONSTRAINT private_evidence_metadata_category_check CHECK (
    category IN (
      'hospital_bill', 'admission_or_estimate', 'discharge_or_support', 'loan_balance',
      'lender_notice', 'property_damage', 'official_report', 'repair_estimate', 'other_supporting'
    )
  );

ALTER TABLE private_evidence_metadata DROP CONSTRAINT IF EXISTS private_evidence_metadata_description_check;
ALTER TABLE private_evidence_metadata
  ADD CONSTRAINT private_evidence_metadata_description_check CHECK (char_length(description) <= 240);

ALTER TABLE private_evidence_metadata DROP CONSTRAINT IF EXISTS private_evidence_metadata_review_check;
ALTER TABLE private_evidence_metadata
  ADD CONSTRAINT private_evidence_metadata_review_check CHECK (
    review_status IN ('pending_review', 'verified', 'rejected', 'needs_clarification')
    AND char_length(review_note) <= 1000
  );

ALTER TABLE private_evidence_metadata DROP CONSTRAINT IF EXISTS private_evidence_metadata_scan_check;
ALTER TABLE private_evidence_metadata
  ADD CONSTRAINT private_evidence_metadata_scan_check CHECK (
    scan_status = 'not_scanned' AND duration_measured = false
  );

CREATE INDEX IF NOT EXISTS private_evidence_campaign_idx
  ON private_evidence_metadata (campaign_id)
  WHERE campaign_id IS NOT NULL;

DROP POLICY IF EXISTS evidence_insert ON private_evidence_metadata;
CREATE POLICY evidence_insert ON private_evidence_metadata FOR INSERT
  WITH CHECK (
    jirani.is_self(owner_profile_id)
    AND review_status = 'pending_review'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND scan_status = 'not_scanned'
    AND duration_measured = false
    AND (
      (
        request_id IS NOT NULL
        AND campaign_id IS NULL
        AND EXISTS (
          SELECT 1 FROM assistance_requests r
          WHERE r.id = request_id
            AND jirani.is_self(r.recipient_profile_id)
            AND r.status IN ('draft', 'submitted', 'under_review', 'needs_information')
        )
      )
      OR (
        campaign_id IS NOT NULL
        AND request_id IS NULL
        AND jirani.is_admin()
        AND EXISTS (
          SELECT 1 FROM campaigns c
          WHERE c.id = campaign_id AND c.status IN ('draft', 'under_review')
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION jirani.protect_evidence_review() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.review_status IS DISTINCT FROM OLD.review_status
     OR NEW.review_note IS DISTINCT FROM OLD.review_note
     OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     OR NEW.scan_status IS DISTINCT FROM OLD.scan_status
     OR NEW.duration_measured IS DISTINCT FROM OLD.duration_measured
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.content_type IS DISTINCT FROM OLD.content_type
     OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.owner_profile_id IS DISTINCT FROM OLD.owner_profile_id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
  THEN
    IF current_setting('jirani.trusted_evidence_review', true) IS DISTINCT FROM 'on'
       OR NOT jirani.trusted_writer() THEN
      RAISE EXCEPTION 'evidence review status cannot be changed directly';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS private_evidence_review_guard ON private_evidence_metadata;
CREATE TRIGGER private_evidence_review_guard
  BEFORE UPDATE ON private_evidence_metadata
  FOR EACH ROW EXECUTE FUNCTION jirani.protect_evidence_review();

CREATE OR REPLACE FUNCTION jirani.limit_evidence_files() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.request_id IS NOT NULL AND (
    SELECT count(*) FROM private_evidence_metadata WHERE request_id = NEW.request_id
  ) >= 10 THEN
    RAISE EXCEPTION 'this application already has the maximum number of files';
  END IF;
  IF NEW.campaign_id IS NOT NULL AND (
    SELECT count(*) FROM private_evidence_metadata WHERE campaign_id = NEW.campaign_id
  ) >= 10 THEN
    RAISE EXCEPTION 'this application already has the maximum number of files';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS private_evidence_file_limit ON private_evidence_metadata;
CREATE TRIGGER private_evidence_file_limit
  BEFORE INSERT ON private_evidence_metadata
  FOR EACH ROW EXECUTE FUNCTION jirani.limit_evidence_files();

CREATE OR REPLACE FUNCTION jirani.review_private_evidence(
  target uuid,
  next_status text,
  note text,
  watched boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row private_evidence_metadata%ROWTYPE;
  actor uuid;
BEGIN
  actor := jirani.profile_id();
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM user_roles WHERE profile_id = actor AND role = 'administrator'
  ) THEN
    RAISE EXCEPTION 'only an administrator can review evidence';
  END IF;
  SELECT * INTO row FROM private_evidence_metadata WHERE id = target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that evidence file does not exist';
  END IF;
  IF row.owner_profile_id = actor OR EXISTS (
    SELECT 1 FROM assistance_requests r
    WHERE r.id = row.request_id AND r.recipient_profile_id = actor
  ) THEN
    RAISE EXCEPTION 'you cannot review evidence on your own application';
  END IF;
  IF next_status NOT IN ('pending_review', 'verified', 'rejected', 'needs_clarification') THEN
    RAISE EXCEPTION 'that evidence status is not available';
  END IF;
  IF char_length(trim(coalesce(note, ''))) < 8 THEN
    RAISE EXCEPTION 'record a reason of at least 8 characters';
  END IF;
  IF next_status = 'verified' AND row.content_type IN ('video/mp4', 'video/webm') AND watched IS NOT TRUE THEN
    RAISE EXCEPTION 'watch the video before marking it verified';
  END IF;
  PERFORM set_config('jirani.trusted_evidence_review', 'on', true);
  UPDATE private_evidence_metadata
  SET review_status = next_status,
      review_note = trim(note),
      reviewed_by = actor,
      reviewed_at = now()
  WHERE id = target;
  PERFORM jirani.write_audit(
    actor,
    'evidence.reviewed',
    'private_evidence',
    target,
    'An administrator recorded an evidence review.',
    jsonb_build_object('status', next_status)
  );
END;
$$;

CREATE OR REPLACE FUNCTION jirani.remove_pending_evidence(target uuid) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row private_evidence_metadata%ROWTYPE;
  actor uuid;
  storage text;
BEGIN
  actor := jirani.profile_id();
  IF actor IS NULL THEN
    RAISE EXCEPTION 'sign in to continue';
  END IF;
  SELECT * INTO row FROM private_evidence_metadata WHERE id = target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that evidence file does not exist';
  END IF;
  IF row.review_status IS DISTINCT FROM 'pending_review' THEN
    RAISE EXCEPTION 'a reviewed file stays with the application';
  END IF;
  IF row.request_id IS NOT NULL THEN
    IF row.owner_profile_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'you can only remove your own file';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM assistance_requests r
      WHERE r.id = row.request_id AND r.recipient_profile_id = actor AND r.status = 'draft'
    ) THEN
      RAISE EXCEPTION 'a file already submitted stays with the application';
    END IF;
  ELSIF row.campaign_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_roles WHERE profile_id = actor AND role = 'administrator'
    ) THEN
      RAISE EXCEPTION 'only an administrator can remove campaign evidence';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = row.campaign_id AND c.status IN ('draft', 'under_review')
    ) THEN
      RAISE EXCEPTION 'a file already submitted stays with the application';
    END IF;
  ELSE
    RAISE EXCEPTION 'that evidence file does not exist';
  END IF;
  storage := row.storage_key;
  PERFORM set_config('jirani.trusted_evidence_review', 'on', true);
  DELETE FROM private_evidence_metadata WHERE id = target;
  PERFORM jirani.write_audit(
    actor,
    'evidence.removed',
    'private_evidence',
    target,
    'Pending evidence was removed before review.',
    '{}'::jsonb
  );
  RETURN storage;
END;
$$;

DROP POLICY IF EXISTS evidence_review_update ON private_evidence_metadata;
CREATE POLICY evidence_review_update ON private_evidence_metadata FOR UPDATE
  USING (
    current_setting('jirani.trusted_evidence_review', true) = 'on'
    AND jirani.trusted_writer()
  )
  WITH CHECK (
    current_setting('jirani.trusted_evidence_review', true) = 'on'
    AND jirani.trusted_writer()
    AND scan_status = 'not_scanned'
    AND duration_measured = false
  );

DROP POLICY IF EXISTS evidence_delete_pending ON private_evidence_metadata;
CREATE POLICY evidence_delete_pending ON private_evidence_metadata FOR DELETE
  USING (
    current_setting('jirani.trusted_evidence_review', true) = 'on'
    AND jirani.trusted_writer()
  );

REVOKE ALL ON FUNCTION jirani.review_private_evidence(uuid, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.remove_pending_evidence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jirani.review_private_evidence(uuid, text, text, boolean) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.remove_pending_evidence(uuid) TO jirani_app;

COMMENT ON COLUMN private_evidence_metadata.scan_status IS
  'No malware scanner is configured. The only stored value is not_scanned.';
COMMENT ON COLUMN private_evidence_metadata.duration_measured IS
  'Always false. This build cannot measure video duration.';
COMMENT ON COLUMN private_evidence_metadata.storage_key IS
  'A generated file name inside private storage. It is not a public URL and it is not the original file name.';
COMMENT ON COLUMN assistance_request_private.evidence_gap IS
  'The applicant explanation when a document is unavailable. It is not a public campaign description.';
COMMENT ON TABLE private_evidence_metadata IS
  'Private evidence metadata for the owner and an administrator. Donors have no read policy. Bytes are not stored in this table. No retention interval is defined.';

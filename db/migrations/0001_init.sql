-- Jirani foundation schema.
-- Apply with: npm run migrate
-- The runtime role is jirani_app. It is subject to row-level security.
-- Superusers bypass row-level security; do not run the web app as a superuser.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jirani_app') THEN
    CREATE ROLE jirani_app NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS jirani;

CREATE TYPE user_role AS ENUM ('recipient', 'donor', 'administrator');
CREATE TYPE verification_status AS ENUM (
  'not_started', 'submitted', 'under_review', 'verified', 'needs_information', 'rejected'
);
CREATE TYPE request_status AS ENUM (
  'draft', 'submitted', 'under_review', 'needs_information', 'verified',
  'rejected', 'published', 'suspended', 'closed'
);
CREATE TYPE campaign_status AS ENUM (
  'draft', 'scheduled', 'active', 'closed', 'reconciling', 'reported', 'cancelled'
);
CREATE TYPE payment_status AS ENUM ('pending', 'successful', 'failed', 'reversed');
CREATE TYPE fee_payer AS ENUM ('donor', 'campaign', 'platform_absorbed', 'optional_donor');
CREATE TYPE recognition AS ENUM ('public', 'anonymous');
CREATE TYPE complaint_status AS ENUM ('open', 'in_review', 'resolved');
CREATE TYPE disbursement_status AS ENUM ('approved', 'rejected');

CREATE FUNCTION jirani.profile_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('jirani.profile_id', true), '')::uuid
$$;

CREATE FUNCTION jirani.role_list() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('jirani.roles', true), '')
$$;

CREATE FUNCTION jirani.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT position('administrator' IN jirani.role_list()) > 0
$$;

CREATE FUNCTION jirani.is_self(target uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT jirani.profile_id() IS NOT NULL AND jirani.profile_id() = target
$$;

CREATE TABLE profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_display_name text NOT NULL CHECK (char_length(public_display_name) BETWEEN 2 AND 80),
  email text NOT NULL CHECK (position('@' IN email) > 1),
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz
);

CREATE UNIQUE INDEX profiles_email_lower_idx ON profiles (lower(email));

CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  role user_role NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES profiles (id),
  UNIQUE (profile_id, role)
);

CREATE TABLE recipient_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES profiles (id),
  legal_name text NOT NULL,
  id_document_reference text,
  status verification_status NOT NULL DEFAULT 'not_started',
  reviewer_id uuid REFERENCES profiles (id),
  review_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipient_verifications_no_self_review CHECK (reviewer_id IS NULL OR reviewer_id <> profile_id)
);

CREATE TABLE assistance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_profile_id uuid NOT NULL REFERENCES profiles (id),
  public_alias text NOT NULL CHECK (char_length(public_alias) BETWEEN 2 AND 60),
  category text NOT NULL CHECK (category IN (
    'food', 'rent', 'electricity', 'cooking_gas', 'school', 'medical', 'funeral', 'other'
  )),
  title text NOT NULL CHECK (char_length(title) BETWEEN 8 AND 120),
  public_summary text NOT NULL CHECK (char_length(public_summary) BETWEEN 40 AND 800),
  county text NOT NULL,
  amount_needed_minor bigint NOT NULL CHECK (amount_needed_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  status request_status NOT NULL DEFAULT 'draft',
  demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  closed_at timestamptz
);

CREATE INDEX assistance_requests_owner_idx ON assistance_requests (recipient_profile_id);
CREATE INDEX assistance_requests_published_idx ON assistance_requests (published_at DESC)
  WHERE status = 'published';

CREATE TABLE assistance_request_private (
  request_id uuid PRIMARY KEY REFERENCES assistance_requests (id) ON DELETE CASCADE,
  situation_notes text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE private_evidence_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES assistance_requests (id) ON DELETE CASCADE,
  owner_profile_id uuid NOT NULL REFERENCES profiles (id),
  file_name text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 2000000),
  sha256 text NOT NULL,
  storage_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX private_evidence_request_idx ON private_evidence_metadata (request_id);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  objective text NOT NULL,
  target_amount_minor bigint NOT NULL CHECK (target_amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  eligibility_criteria text NOT NULL,
  beneficiary_selection_rules text NOT NULL,
  fee_disclosure text NOT NULL,
  refund_policy text NOT NULL,
  surplus_policy text NOT NULL,
  status campaign_status NOT NULL DEFAULT 'draft',
  demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_dates CHECK (ends_at > starts_at)
);

CREATE INDEX campaigns_status_idx ON campaigns (status, ends_at);

CREATE TABLE campaign_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns (id),
  request_id uuid REFERENCES assistance_requests (id),
  description text NOT NULL,
  allocated_amount_minor bigint NOT NULL CHECK (allocated_amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  rationale text NOT NULL CHECK (char_length(rationale) >= 8),
  approved_by uuid NOT NULL REFERENCES profiles (id),
  approved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_profile_id uuid NOT NULL REFERENCES profiles (id),
  request_id uuid REFERENCES assistance_requests (id),
  campaign_id uuid REFERENCES campaigns (id),
  recognition recognition NOT NULL,
  public_name text,
  gift_minor bigint NOT NULL CHECK (gift_minor >= 0),
  collected_platform_fee_minor bigint NOT NULL CHECK (collected_platform_fee_minor >= 0),
  campaign_borne_fee_minor bigint NOT NULL CHECK (campaign_borne_fee_minor >= 0),
  provider_fee_minor bigint NOT NULL CHECK (provider_fee_minor >= 0),
  donor_pays_minor bigint NOT NULL CHECK (donor_pays_minor >= 0),
  net_to_cause_minor bigint NOT NULL CHECK (net_to_cause_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  status payment_status NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL UNIQUE,
  provider text NOT NULL,
  provider_reference text NOT NULL UNIQUE,
  simulated boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contributions_one_target CHECK (
    (request_id IS NOT NULL AND campaign_id IS NULL)
    OR (request_id IS NULL AND campaign_id IS NOT NULL)
  ),
  CONSTRAINT contributions_amounts CHECK (
    donor_pays_minor = gift_minor + collected_platform_fee_minor
    AND net_to_cause_minor = gift_minor - campaign_borne_fee_minor
  ),
  CONSTRAINT contributions_not_self CHECK (donor_profile_id IS NOT NULL)
);

CREATE INDEX contributions_donor_idx ON contributions (donor_profile_id, created_at DESC);
CREATE INDEX contributions_request_idx ON contributions (request_id);
CREATE INDEX contributions_campaign_idx ON contributions (campaign_id);

CREATE TABLE payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id uuid NOT NULL REFERENCES contributions (id),
  provider_event_id text NOT NULL UNIQUE,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'duplicate', 'rejected')),
  verified_status payment_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id uuid NOT NULL REFERENCES contributions (id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  reason text NOT NULL CHECK (char_length(reason) >= 8),
  idempotency_key text NOT NULL UNIQUE,
  approved_by uuid NOT NULL REFERENCES profiles (id),
  simulated boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns (id),
  request_id uuid REFERENCES assistance_requests (id),
  beneficiary_profile_id uuid REFERENCES profiles (id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  status disbursement_status NOT NULL,
  funds_sent boolean NOT NULL DEFAULT false,
  provider_transfer_reference text,
  reason text NOT NULL CHECK (char_length(reason) >= 8),
  decided_by uuid NOT NULL REFERENCES profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disbursements_sent_has_reference CHECK (
    funds_sent = false OR provider_transfer_reference IS NOT NULL
  ),
  CONSTRAINT disbursements_no_self CHECK (
    beneficiary_profile_id IS NULL OR beneficiary_profile_id <> decided_by
  )
);

CREATE TABLE provider_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id uuid NOT NULL REFERENCES contributions (id),
  provider text NOT NULL,
  provider_reference text NOT NULL,
  verified_status payment_status NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_reference, verified_at)
);

CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id uuid NOT NULL UNIQUE REFERENCES contributions (id),
  receipt_number text NOT NULL UNIQUE,
  simulated boolean NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns (id),
  narrative text NOT NULL,
  gross_gift_minor bigint NOT NULL CHECK (gross_gift_minor >= 0),
  platform_fee_minor bigint NOT NULL CHECK (platform_fee_minor >= 0),
  net_gift_minor bigint NOT NULL,
  disbursement_approved_minor bigint NOT NULL CHECK (disbursement_approved_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  demo boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid NOT NULL REFERENCES profiles (id)
);

CREATE TABLE complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_profile_id uuid REFERENCES profiles (id),
  subject_type text NOT NULL CHECK (subject_type IN ('request', 'campaign', 'contribution', 'platform')),
  subject_id uuid,
  body text NOT NULL CHECK (char_length(body) BETWEEN 20 AND 2000),
  status complaint_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE administrative_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_entity_idx ON administrative_audit_logs (entity_type, entity_id, created_at DESC);

CREATE TABLE platform_fee_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  applies_to text NOT NULL CHECK (applies_to IN ('assistance_request', 'campaign')),
  campaign_type text,
  rate_bps integer CHECK (rate_bps IS NULL OR (rate_bps >= 0 AND rate_bps <= 10000)),
  fixed_minor bigint CHECK (fixed_minor IS NULL OR fixed_minor >= 0),
  payer fee_payer NOT NULL,
  active boolean NOT NULL DEFAULT false,
  demo_only boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_fee_rules_has_amount CHECK (rate_bps IS NOT NULL OR fixed_minor IS NOT NULL),
  CONSTRAINT platform_fee_rules_demo_inactive CHECK (NOT (active AND demo_only))
);

CREATE TABLE consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles (id),
  consent_type text NOT NULL CHECK (consent_type IN (
    'terms', 'privacy', 'request_publication', 'verification'
  )),
  policy_version text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz
);

INSERT INTO platform_fee_rules (
  name, applies_to, rate_bps, fixed_minor, payer, active, demo_only
) VALUES (
  'Inactive demonstration rule — do not collect',
  'campaign',
  0,
  0,
  'platform_absorbed',
  false,
  true
);

CREATE FUNCTION jirani.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION jirani.touch_updated_at();
CREATE TRIGGER requests_touch BEFORE UPDATE ON assistance_requests
  FOR EACH ROW EXECUTE FUNCTION jirani.touch_updated_at();
CREATE TRIGGER campaigns_touch BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION jirani.touch_updated_at();

CREATE FUNCTION jirani.enforce_request_status() RETURNS trigger
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
    RETURN NEW;
  END IF;

  IF NEW.recipient_profile_id IS DISTINCT FROM OLD.recipient_profile_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'request identity fields are immutable';
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

CREATE TRIGGER assistance_requests_status
  BEFORE INSERT OR UPDATE ON assistance_requests
  FOR EACH ROW EXECUTE FUNCTION jirani.enforce_request_status();

CREATE FUNCTION jirani.protect_contribution() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'contributions cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.donor_profile_id IS DISTINCT FROM OLD.donor_profile_id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
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
    (OLD.status = 'pending' AND NEW.status IN ('successful', 'failed'))
    OR (OLD.status = 'successful' AND NEW.status = 'reversed')
  ) THEN
    RAISE EXCEPTION 'illegal contribution status transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contributions_protect
  BEFORE UPDATE OR DELETE ON contributions
  FOR EACH ROW EXECUTE FUNCTION jirani.protect_contribution();

CREATE FUNCTION jirani.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER payment_events_append_only
  BEFORE UPDATE OR DELETE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION jirani.reject_mutation();
CREATE TRIGGER refunds_append_only
  BEFORE UPDATE OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION jirani.reject_mutation();
CREATE TRIGGER audit_append_only
  BEFORE UPDATE OR DELETE ON administrative_audit_logs
  FOR EACH ROW EXECUTE FUNCTION jirani.reject_mutation();
CREATE TRIGGER receipts_append_only
  BEFORE UPDATE OR DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION jirani.reject_mutation();
CREATE TRIGGER provider_verifications_append_only
  BEFORE UPDATE OR DELETE ON provider_verifications
  FOR EACH ROW EXECUTE FUNCTION jirani.reject_mutation();

CREATE FUNCTION jirani.protect_disbursement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.beneficiary_profile_id IS DISTINCT FROM OLD.beneficiary_profile_id
     OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
    RAISE EXCEPTION 'disbursement amounts and parties are immutable';
  END IF;
  IF NEW.funds_sent = true AND OLD.funds_sent = false AND NEW.provider_transfer_reference IS NULL THEN
    RAISE EXCEPTION 'a transfer reference is required before funds_sent can be true';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER disbursements_protect
  BEFORE UPDATE ON disbursements
  FOR EACH ROW EXECUTE FUNCTION jirani.protect_disbursement();

CREATE FUNCTION jirani.disbursement_requires_reconciliation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  campaign_state campaign_status;
BEGIN
  IF NEW.decided_by = jirani.profile_id() AND NEW.beneficiary_profile_id = jirani.profile_id() THEN
    RAISE EXCEPTION 'you cannot approve a disbursement to yourself';
  END IF;
  IF NEW.campaign_id IS NOT NULL THEN
    SELECT status INTO campaign_state FROM campaigns WHERE id = NEW.campaign_id;
    IF campaign_state IS NULL OR campaign_state NOT IN ('closed', 'reconciling') THEN
      RAISE EXCEPTION 'approve a disbursement only after the campaign is closed and before the report is published';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER disbursements_timing
  BEFORE INSERT ON disbursements
  FOR EACH ROW EXECUTE FUNCTION jirani.disbursement_requires_reconciliation();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE recipient_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipient_verifications FORCE ROW LEVEL SECURITY;
ALTER TABLE assistance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistance_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE assistance_request_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistance_request_private FORCE ROW LEVEL SECURITY;
ALTER TABLE private_evidence_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_evidence_metadata FORCE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE campaign_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributions FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events FORCE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
ALTER TABLE disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursements FORCE ROW LEVEL SECURITY;
ALTER TABLE provider_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_verifications FORCE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints FORCE ROW LEVEL SECURITY;
ALTER TABLE administrative_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE administrative_audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_fee_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_fee_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (jirani.is_admin() OR jirani.is_self(id));
CREATE POLICY profiles_update_self ON profiles FOR UPDATE
  USING (jirani.is_self(id)) WITH CHECK (jirani.is_self(id));

CREATE POLICY roles_select ON user_roles FOR SELECT
  USING (jirani.is_admin() OR jirani.is_self(profile_id));

CREATE POLICY verification_select ON recipient_verifications FOR SELECT
  USING (jirani.is_admin() OR jirani.is_self(profile_id));
CREATE POLICY verification_admin_write ON recipient_verifications FOR UPDATE
  USING (jirani.is_admin() AND NOT jirani.is_self(profile_id))
  WITH CHECK (jirani.is_admin() AND reviewer_id IS DISTINCT FROM profile_id);

CREATE POLICY requests_select ON assistance_requests FOR SELECT
  USING (
    status = 'published'
    OR jirani.is_self(recipient_profile_id)
    OR jirani.is_admin()
  );
CREATE POLICY requests_insert ON assistance_requests FOR INSERT
  WITH CHECK (jirani.is_self(recipient_profile_id));
CREATE POLICY requests_update ON assistance_requests FOR UPDATE
  USING (jirani.is_self(recipient_profile_id) OR jirani.is_admin())
  WITH CHECK (jirani.is_self(recipient_profile_id) OR jirani.is_admin());

CREATE POLICY request_private_select ON assistance_request_private FOR SELECT
  USING (
    jirani.is_admin()
    OR EXISTS (
      SELECT 1 FROM assistance_requests r
      WHERE r.id = request_id AND jirani.is_self(r.recipient_profile_id)
    )
  );
CREATE POLICY request_private_write ON assistance_request_private FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM assistance_requests r
      WHERE r.id = request_id AND jirani.is_self(r.recipient_profile_id)
    )
  );
CREATE POLICY request_private_update ON assistance_request_private FOR UPDATE
  USING (
    jirani.is_admin()
    OR EXISTS (
      SELECT 1 FROM assistance_requests r
      WHERE r.id = request_id AND jirani.is_self(r.recipient_profile_id)
    )
  );

CREATE POLICY evidence_select ON private_evidence_metadata FOR SELECT
  USING (jirani.is_admin() OR jirani.is_self(owner_profile_id));
CREATE POLICY evidence_insert ON private_evidence_metadata FOR INSERT
  WITH CHECK (jirani.is_self(owner_profile_id));

CREATE POLICY campaigns_select ON campaigns FOR SELECT USING (true);
CREATE POLICY campaigns_admin ON campaigns FOR ALL
  USING (jirani.is_admin()) WITH CHECK (jirani.is_admin());

CREATE POLICY allocations_select ON campaign_allocations FOR SELECT USING (true);
CREATE POLICY allocations_admin ON campaign_allocations FOR INSERT
  WITH CHECK (jirani.is_admin());

CREATE POLICY contributions_select ON contributions FOR SELECT
  USING (jirani.is_admin() OR jirani.is_self(donor_profile_id));
CREATE POLICY contributions_insert ON contributions FOR INSERT
  WITH CHECK (jirani.is_self(donor_profile_id) AND position('donor' IN jirani.role_list()) > 0);
CREATE POLICY contributions_update ON contributions FOR UPDATE
  USING (jirani.is_admin())
  WITH CHECK (jirani.is_admin());

CREATE POLICY payment_events_admin ON payment_events FOR SELECT
  USING (jirani.is_admin());
CREATE POLICY payment_events_insert ON payment_events FOR INSERT
  WITH CHECK (jirani.is_admin());
CREATE POLICY refunds_select ON refunds FOR SELECT USING (jirani.is_admin());
CREATE POLICY refunds_insert ON refunds FOR INSERT WITH CHECK (jirani.is_admin());

CREATE POLICY disbursements_admin ON disbursements FOR SELECT USING (jirani.is_admin());
CREATE POLICY disbursements_insert ON disbursements FOR INSERT
  WITH CHECK (jirani.is_admin() AND decided_by IS DISTINCT FROM beneficiary_profile_id);

CREATE POLICY provider_verifications_admin ON provider_verifications FOR SELECT
  USING (jirani.is_admin());
CREATE POLICY provider_verifications_insert ON provider_verifications FOR INSERT
  WITH CHECK (jirani.is_admin());
CREATE POLICY receipts_insert ON receipts FOR INSERT WITH CHECK (jirani.is_admin());
CREATE POLICY receipts_select ON receipts FOR SELECT
  USING (
    jirani.is_admin()
    OR EXISTS (
      SELECT 1 FROM contributions c
      WHERE c.id = contribution_id AND jirani.is_self(c.donor_profile_id)
    )
  );

CREATE POLICY reports_select ON reports FOR SELECT USING (true);
CREATE POLICY reports_insert ON reports FOR INSERT WITH CHECK (jirani.is_admin());

CREATE POLICY complaints_insert ON complaints FOR INSERT WITH CHECK (true);
CREATE POLICY complaints_select ON complaints FOR SELECT
  USING (jirani.is_admin() OR jirani.is_self(reporter_profile_id));

CREATE POLICY audit_admin ON administrative_audit_logs FOR SELECT USING (jirani.is_admin());
CREATE POLICY audit_insert ON administrative_audit_logs FOR INSERT WITH CHECK (jirani.is_admin() OR actor_id = jirani.profile_id());

CREATE POLICY fee_rules_select ON platform_fee_rules FOR SELECT USING (true);
CREATE POLICY fee_rules_admin ON platform_fee_rules FOR ALL
  USING (jirani.is_admin()) WITH CHECK (jirani.is_admin());

CREATE POLICY consent_select ON consent_records FOR SELECT
  USING (jirani.is_admin() OR jirani.is_self(profile_id));
CREATE POLICY consent_insert ON consent_records FOR INSERT
  WITH CHECK (jirani.is_self(profile_id));

CREATE VIEW public_assistance_requests
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
  published_at
FROM assistance_requests
WHERE status = 'published';

GRANT USAGE ON SCHEMA public, jirani TO jirani_app;
GRANT SELECT ON public_assistance_requests TO jirani_app;
GRANT SELECT, INSERT, UPDATE ON
  profiles, user_roles, recipient_verifications, assistance_requests,
  assistance_request_private, private_evidence_metadata, campaigns,
  campaign_allocations, contributions, complaints, consent_records, platform_fee_rules
TO jirani_app;
GRANT SELECT, INSERT ON
  payment_events, refunds, disbursements, provider_verifications, receipts,
  reports, administrative_audit_logs
TO jirani_app;
GRANT USAGE ON TYPE
  user_role, verification_status, request_status, campaign_status, payment_status,
  fee_payer, recognition, complaint_status, disbursement_status
TO jirani_app;

COMMENT ON TABLE contributions IS
  'Financial amounts are immutable. Correct a mistake with a refund or reversal row.';
COMMENT ON COLUMN disbursements.funds_sent IS
  'Approval does not send money. funds_sent stays false until a later provider transfer is recorded.';
COMMENT ON TABLE private_evidence_metadata IS
  'Donors have no policy that can read this table. storage_key is not a public URL.';

-- Monthly campaigns use the same contribution and ledger tables as assistance requests.
-- A contribution references one published request or one active campaign, never both.
-- Amounts stay integer cents. 100 cents = KSh 1.
-- Closing a campaign does not delete gifts and does not send money.

ALTER TABLE campaigns
  ADD COLUMN slug text,
  ADD COLUMN category text,
  ADD COLUMN county text,
  ADD COLUMN beneficiary_group text,
  ADD COLUMN image_path text,
  ADD COLUMN cancellation_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by uuid,
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_by uuid;

UPDATE campaigns
SET slug = 'campaign-' || substr(replace(id::text, '-', ''), 1, 12)
WHERE slug IS NULL;
UPDATE campaigns SET category = 'other' WHERE category IS NULL;
UPDATE campaigns SET county = 'Kenya' WHERE county IS NULL;
UPDATE campaigns SET beneficiary_group = 'See the objective' WHERE beneficiary_group IS NULL;

ALTER TABLE campaigns
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN category SET NOT NULL,
  ALTER COLUMN county SET NOT NULL,
  ALTER COLUMN beneficiary_group SET NOT NULL;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_slug_unique UNIQUE (slug),
  ADD CONSTRAINT campaigns_slug_shape CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  ADD CONSTRAINT campaigns_category_check CHECK (category IN (
    'food', 'rent', 'school', 'medical', 'hygiene', 'maternity', 'funeral', 'clothing', 'other'
  )),
  ADD CONSTRAINT campaigns_target_whole_shillings CHECK (
    target_amount_minor >= 10000
    AND target_amount_minor <= 200000000
    AND target_amount_minor % 100 = 0
  ),
  ADD CONSTRAINT campaigns_image_path_check CHECK (
    image_path IS NULL
    OR image_path ~ '^/campaign-images/[0-9a-f-]{36}\.(jpg|png|webp)$'
  );

CREATE INDEX campaigns_public_idx ON campaigns (status, ends_at DESC);

CREATE TABLE campaign_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns (id),
  from_status campaign_status,
  to_status campaign_status NOT NULL,
  actor_id uuid,
  reason text NOT NULL CHECK (char_length(reason) >= 8),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaign_status_events_idx ON campaign_status_events (campaign_id, created_at);

CREATE TABLE campaign_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL UNIQUE REFERENCES campaigns (id),
  method text NOT NULL CHECK (method = 'manual'),
  eligible_reference text NOT NULL CHECK (char_length(eligible_reference) BETWEEN 8 AND 500),
  outcome_summary text NOT NULL CHECK (char_length(outcome_summary) BETWEEN 8 AND 800),
  allocated_amount_minor bigint NOT NULL CHECK (allocated_amount_minor >= 0),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL UNIQUE REFERENCES campaigns (id),
  net_minor bigint NOT NULL,
  contribution_count integer NOT NULL CHECK (contribution_count >= 0),
  unresolved_notes text NOT NULL CHECK (char_length(unresolved_notes) >= 8),
  surplus_note text NOT NULL CHECK (char_length(surplus_note) >= 8),
  actor_id uuid NOT NULL,
  funds_sent boolean NOT NULL DEFAULT false CHECK (funds_sent = false),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION jirani.reject_campaign_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER campaign_status_events_append_only
  BEFORE UPDATE OR DELETE ON campaign_status_events
  FOR EACH ROW EXECUTE FUNCTION jirani.reject_campaign_audit_mutation();
CREATE TRIGGER campaign_selections_append_only
  BEFORE UPDATE OR DELETE ON campaign_selections
  FOR EACH ROW EXECUTE FUNCTION jirani.reject_campaign_audit_mutation();
CREATE TRIGGER campaign_reconciliations_append_only
  BEFORE UPDATE OR DELETE ON campaign_reconciliations
  FOR EACH ROW EXECUTE FUNCTION jirani.reject_campaign_audit_mutation();

CREATE FUNCTION jirani.require_campaign_writer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('jirani.trusted_campaign_write', true) IS DISTINCT FROM 'on'
     OR NOT jirani.trusted_writer() THEN
    RAISE EXCEPTION 'campaign records are posted by the campaign functions';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER campaigns_writer
  BEFORE INSERT OR UPDATE OR DELETE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION jirani.require_campaign_writer();
CREATE TRIGGER campaign_events_writer
  BEFORE INSERT ON campaign_status_events
  FOR EACH ROW EXECUTE FUNCTION jirani.require_campaign_writer();
CREATE TRIGGER campaign_selections_writer
  BEFORE INSERT ON campaign_selections
  FOR EACH ROW EXECUTE FUNCTION jirani.require_campaign_writer();
CREATE TRIGGER campaign_reconciliations_writer
  BEFORE INSERT ON campaign_reconciliations
  FOR EACH ROW EXECUTE FUNCTION jirani.require_campaign_writer();
CREATE TRIGGER reports_writer
  BEFORE INSERT ON reports
  FOR EACH ROW EXECUTE FUNCTION jirani.require_campaign_writer();

CREATE FUNCTION jirani.record_campaign_status() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('jirani.trusted_campaign_write', 'on', true);
  INSERT INTO campaign_status_events (campaign_id, from_status, to_status, actor_id, reason)
  VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    jirani.profile_id(),
    left(coalesce(current_setting('jirani.campaign_reason', true), ''), 2000)
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER campaigns_history
  AFTER INSERT OR UPDATE OF status ON campaigns
  FOR EACH ROW EXECUTE FUNCTION jirani.record_campaign_status();

CREATE OR REPLACE FUNCTION jirani.raised_for_campaign(target uuid) RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(e.amount_minor), 0)
  FROM ledger_entries e
  JOIN contributions c ON c.id = e.contribution_id
  WHERE c.campaign_id = target
    AND c.status = 'successful'
    AND e.entry_type IN ('gift', 'refund', 'adjustment')
$$;

CREATE OR REPLACE FUNCTION jirani.campaign_contribution_count(target uuid) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM contributions c
  WHERE c.campaign_id = target
    AND c.status = 'successful'
    AND c.net_to_cause_minor + coalesce((
      SELECT sum(e.amount_minor)
      FROM ledger_entries e
      WHERE e.contribution_id = c.id AND e.entry_type IN ('refund', 'adjustment')
    ), 0) > 0
$$;

CREATE OR REPLACE FUNCTION jirani.save_campaign(
  target uuid,
  next_title text,
  next_slug text,
  next_category text,
  next_objective text,
  next_target bigint,
  next_starts timestamptz,
  next_ends timestamptz,
  next_county text,
  next_group text,
  next_eligibility text,
  next_selection text,
  next_fee text,
  next_refund text,
  next_surplus text,
  next_cancellation boolean,
  next_image text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := jirani.profile_id();
  created uuid;
  current_status campaign_status;
BEGIN
  IF actor IS NULL OR NOT jirani.is_admin() OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = actor) THEN
    RAISE EXCEPTION 'only a registered administrator can save a campaign';
  END IF;
  IF char_length(coalesce(next_title, '')) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'the title must be between 8 and 120 characters';
  END IF;
  IF next_slug IS NULL OR next_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' OR char_length(next_slug) NOT BETWEEN 3 AND 80 THEN
    RAISE EXCEPTION 'the campaign link must use lowercase letters, numbers, and hyphens';
  END IF;
  IF next_category NOT IN ('food', 'rent', 'school', 'medical', 'hygiene', 'maternity', 'funeral', 'clothing', 'other') THEN
    RAISE EXCEPTION 'choose a campaign category';
  END IF;
  IF char_length(coalesce(next_objective, '')) NOT BETWEEN 40 AND 2000
     OR char_length(coalesce(next_eligibility, '')) NOT BETWEEN 40 AND 2000
     OR char_length(coalesce(next_selection, '')) NOT BETWEEN 40 AND 2000
     OR char_length(coalesce(next_fee, '')) NOT BETWEEN 20 AND 2000
     OR char_length(coalesce(next_refund, '')) NOT BETWEEN 20 AND 2000
     OR char_length(coalesce(next_surplus, '')) NOT BETWEEN 20 AND 2000
     OR char_length(coalesce(next_group, '')) NOT BETWEEN 8 AND 200
     OR char_length(coalesce(next_county, '')) NOT BETWEEN 3 AND 40 THEN
    RAISE EXCEPTION 'the campaign description, rules, and disclosures are incomplete';
  END IF;
  IF next_target IS NULL OR next_target < 10000 OR next_target > 200000000 OR next_target % 100 <> 0 THEN
    RAISE EXCEPTION 'enter a whole number of shillings from KES 100 to KES 2000000';
  END IF;
  IF next_starts IS NULL OR next_ends IS NULL OR next_ends <= next_starts THEN
    RAISE EXCEPTION 'the closing date must be after the opening date';
  END IF;
  IF next_image IS NOT NULL AND next_image !~ '^/campaign-images/[0-9a-f-]{36}\.(jpg|png|webp)$' THEN
    RAISE EXCEPTION 'the campaign image could not be stored';
  END IF;
  IF EXISTS (SELECT 1 FROM campaigns WHERE slug = next_slug AND id IS DISTINCT FROM target) THEN
    RAISE EXCEPTION 'that campaign link is already in use';
  END IF;

  PERFORM set_config('jirani.trusted_campaign_write', 'on', true);
  PERFORM set_config('jirani.campaign_reason', 'Draft saved by an administrator.', true);
  IF target IS NULL THEN
    INSERT INTO campaigns (
      title, slug, category, objective, target_amount_minor, starts_at, ends_at, county,
      beneficiary_group, eligibility_criteria, beneficiary_selection_rules, fee_disclosure,
      refund_policy, surplus_policy, cancellation_allowed, image_path, status, demo, created_by
    ) VALUES (
      next_title, next_slug, next_category, next_objective, next_target, next_starts, next_ends, next_county,
      next_group, next_eligibility, next_selection, next_fee,
      next_refund, next_surplus, coalesce(next_cancellation, false), next_image, 'draft', false, actor
    ) RETURNING id INTO created;
  ELSE
    SELECT status INTO current_status FROM campaigns WHERE id = target FOR UPDATE;
    IF current_status IS NULL THEN
      RAISE EXCEPTION 'that campaign does not exist';
    END IF;
    IF current_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'only a draft can be edited';
    END IF;
    UPDATE campaigns SET
      title = next_title,
      slug = next_slug,
      category = next_category,
      objective = next_objective,
      target_amount_minor = next_target,
      starts_at = next_starts,
      ends_at = next_ends,
      county = next_county,
      beneficiary_group = next_group,
      eligibility_criteria = next_eligibility,
      beneficiary_selection_rules = next_selection,
      fee_disclosure = next_fee,
      refund_policy = next_refund,
      surplus_policy = next_surplus,
      cancellation_allowed = coalesce(next_cancellation, false),
      image_path = next_image,
      updated_at = now()
    WHERE id = target
    RETURNING id INTO created;
  END IF;
  PERFORM set_config('jirani.trusted_campaign_write', 'off', true);
  PERFORM jirani.write_audit(actor, 'campaign.saved', 'campaign', created, 'Campaign draft saved.', '{}'::jsonb);
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION jirani.transition_campaign(
  target uuid,
  next_status campaign_status,
  reason text
) RETURNS campaign_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := jirani.profile_id();
  current_status campaign_status;
  opens timestamptz;
  closes timestamptz;
  may_cancel boolean;
  surplus text;
  net bigint;
  gifts integer;
BEGIN
  IF actor IS NULL OR NOT jirani.is_admin() OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = actor) THEN
    RAISE EXCEPTION 'only a registered administrator can change a campaign';
  END IF;
  IF char_length(coalesce(reason, '')) < 8 THEN
    RAISE EXCEPTION 'record a reason of at least 8 characters';
  END IF;
  SELECT status, starts_at, ends_at, cancellation_allowed, surplus_policy
    INTO current_status, opens, closes, may_cancel, surplus
  FROM campaigns WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that campaign does not exist';
  END IF;
  IF NOT (
    (current_status = 'draft' AND next_status IN ('under_review', 'cancelled'))
    OR (current_status = 'under_review' AND next_status IN ('approved', 'draft', 'cancelled'))
    OR (current_status = 'approved' AND next_status IN ('scheduled', 'active', 'cancelled'))
    OR (current_status = 'scheduled' AND next_status IN ('active', 'cancelled'))
    OR (current_status = 'active' AND next_status IN ('closed', 'cancelled'))
    OR (current_status = 'closed' AND next_status = 'reconciling')
    OR (current_status = 'reconciling' AND next_status = 'reported')
  ) THEN
    RAISE EXCEPTION 'a campaign cannot move from % to %', current_status, next_status;
  END IF;
  IF next_status = 'cancelled' AND current_status IN ('scheduled', 'active') AND NOT may_cancel THEN
    RAISE EXCEPTION 'this campaign policy does not allow cancellation';
  END IF;
  IF next_status = 'scheduled' AND opens <= now() THEN
    RAISE EXCEPTION 'a campaign that has already opened is made active, not scheduled';
  END IF;
  IF next_status = 'active' AND (opens > now() OR closes <= now()) THEN
    RAISE EXCEPTION 'an active campaign must be inside its opening and closing dates';
  END IF;
  IF next_status IN ('scheduled', 'active') AND (
    char_length(surplus) < 20
  ) THEN
    RAISE EXCEPTION 'publish the eligibility rules and financial disclosures before the campaign opens';
  END IF;

  PERFORM set_config('jirani.campaign_reason', reason, true);
  PERFORM set_config('jirani.trusted_campaign_write', 'on', true);
  UPDATE campaigns SET
    status = next_status,
    approved_at = CASE WHEN next_status = 'approved' THEN now() ELSE approved_at END,
    approved_by = CASE WHEN next_status = 'approved' THEN actor ELSE approved_by END,
    closed_at = CASE WHEN next_status IN ('closed', 'cancelled') AND closed_at IS NULL THEN now() ELSE closed_at END,
    closed_by = CASE WHEN next_status IN ('closed', 'cancelled') AND closed_by IS NULL THEN actor ELSE closed_by END,
    updated_at = now()
  WHERE id = target;

  IF next_status = 'reconciling' THEN
    net := jirani.raised_for_campaign(target);
    gifts := jirani.campaign_contribution_count(target);
    INSERT INTO campaign_reconciliations (
      campaign_id, net_minor, contribution_count, unresolved_notes, surplus_note, actor_id
    ) VALUES (
      target, net, gifts, reason, surplus, actor
    );
  END IF;
  PERFORM set_config('jirani.trusted_campaign_write', 'off', true);
  PERFORM jirani.write_audit(
    actor, 'campaign.' || next_status, 'campaign', target, reason, jsonb_build_object('from', current_status)
  );
  RETURN next_status;
END;
$$;

CREATE OR REPLACE FUNCTION jirani.record_campaign_selection(
  target uuid,
  eligible_reference text,
  outcome_summary text,
  allocated_minor bigint
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := jirani.profile_id();
  current_status campaign_status;
  created uuid;
BEGIN
  IF actor IS NULL OR NOT jirani.is_admin() OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = actor) THEN
    RAISE EXCEPTION 'only a registered administrator can record a selection';
  END IF;
  IF char_length(coalesce(eligible_reference, '')) NOT BETWEEN 8 AND 500
     OR char_length(coalesce(outcome_summary, '')) NOT BETWEEN 8 AND 800 THEN
    RAISE EXCEPTION 'record the eligible group and the decision without private medical details';
  END IF;
  IF outcome_summary ~ '@' OR outcome_summary ~ '[0-9]{6,}' OR eligible_reference ~ '@' THEN
    RAISE EXCEPTION 'a selection record cannot include a phone number or email';
  END IF;
  IF allocated_minor IS NULL OR allocated_minor < 0 OR allocated_minor % 100 <> 0 THEN
    RAISE EXCEPTION 'enter a whole number of shillings from KES 100 to KES 2000000';
  END IF;
  SELECT status INTO current_status FROM campaigns WHERE id = target FOR UPDATE;
  IF current_status NOT IN ('active', 'closed', 'reconciling') THEN
    RAISE EXCEPTION 'record a selection only after the campaign is open';
  END IF;
  IF EXISTS (SELECT 1 FROM campaign_selections WHERE campaign_id = target) THEN
    RAISE EXCEPTION 'a selection has already been recorded and cannot be rerun';
  END IF;
  PERFORM set_config('jirani.trusted_campaign_write', 'on', true);
  INSERT INTO campaign_selections (
    campaign_id, method, eligible_reference, outcome_summary, allocated_amount_minor, actor_id
  ) VALUES (
    target, 'manual', eligible_reference, outcome_summary, allocated_minor, actor
  ) RETURNING id INTO created;
  PERFORM set_config('jirani.trusted_campaign_write', 'off', true);
  PERFORM jirani.write_audit(actor, 'campaign.selection', 'campaign', target, 'Manual selection recorded once.', '{}'::jsonb);
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION jirani.publish_campaign_report(target uuid, narrative text) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := jirani.profile_id();
  current_status campaign_status;
  net bigint;
  created uuid;
BEGIN
  IF actor IS NULL OR NOT jirani.is_admin() OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = actor) THEN
    RAISE EXCEPTION 'only a registered administrator can publish a report';
  END IF;
  IF char_length(coalesce(narrative, '')) NOT BETWEEN 40 AND 4000 THEN
    RAISE EXCEPTION 'the public report needs a short explanation of the result';
  END IF;
  IF narrative ~ '@' OR narrative ~ '[0-9]{6,}' THEN
    RAISE EXCEPTION 'a public report cannot include a phone number, email, or account number';
  END IF;
  SELECT status INTO current_status FROM campaigns WHERE id = target FOR UPDATE;
  IF current_status IS DISTINCT FROM 'reconciling' THEN
    RAISE EXCEPTION 'publish a report only during reconciliation';
  END IF;
  net := jirani.raised_for_campaign(target);
  PERFORM set_config('jirani.trusted_campaign_write', 'on', true);
  INSERT INTO reports (
    campaign_id, narrative, gross_gift_minor, platform_fee_minor, net_gift_minor,
    disbursement_approved_minor, currency, demo, published_by
  ) VALUES (
    target,
    narrative,
    net,
    0,
    net,
    coalesce((
      SELECT sum(amount_minor) FROM disbursements
      WHERE campaign_id = target AND status = 'approved' AND funds_sent = true
    ), 0),
    'KES',
    false,
    actor
  ) RETURNING id INTO created;
  PERFORM set_config('jirani.campaign_reason', 'Public report published from the ledger.', true);
  UPDATE campaigns SET status = 'reported', updated_at = now() WHERE id = target;
  PERFORM set_config('jirani.trusted_campaign_write', 'off', true);
  PERFORM jirani.write_audit(actor, 'campaign.reported', 'campaign', target, 'Public report published from the ledger.', '{}'::jsonb);
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION jirani.record_simulated_campaign_contribution(
  target_campaign uuid,
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
  current_status campaign_status;
  opens timestamptz;
  closes timestamptz;
  existing_id uuid;
  existing_gift bigint;
  existing_donor uuid;
  existing_reference text;
  existing_status payment_status;
  created_id uuid;
  reference text;
  shown_name text;
BEGIN
  IF donor IS NULL OR NOT EXISTS (
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
  IF next_public_name IS NOT NULL AND (next_public_name ~ '@' OR next_public_name ~ '[0-9]{6,}') THEN
    RAISE EXCEPTION 'a public name cannot include a phone number or email';
  END IF;

  SELECT status, starts_at, ends_at
    INTO current_status, opens, closes
  FROM campaigns WHERE id = target_campaign FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contributions are open on active campaigns';
  END IF;
  IF current_status IN ('closed', 'cancelled', 'reconciling', 'reported') THEN
    RAISE EXCEPTION 'this campaign is closed to new gifts';
  END IF;
  IF current_status = 'scheduled' OR (current_status = 'active' AND opens > now()) THEN
    RAISE EXCEPTION 'this campaign has not started';
  END IF;
  IF current_status = 'active' AND closes <= now() THEN
    RAISE EXCEPTION 'this campaign is closed to new gifts';
  END IF;
  IF current_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'contributions are open on active campaigns';
  END IF;

  SELECT id, contributions.gift_minor, donor_profile_id, provider_reference, status
    INTO existing_id, existing_gift, existing_donor, existing_reference, existing_status
  FROM contributions WHERE idempotency_key = next_idempotency_key;
  IF FOUND THEN
    IF existing_donor IS DISTINCT FROM donor OR existing_gift IS DISTINCT FROM gift_minor THEN
      RAISE EXCEPTION 'that idempotency key was already used';
    END IF;
    RETURN jsonb_build_object(
      'id', existing_id, 'providerReference', existing_reference, 'status', existing_status, 'duplicate', true
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
    donor_profile_id, campaign_id, recognition, public_name,
    gift_minor, collected_platform_fee_minor, campaign_borne_fee_minor, provider_fee_minor,
    donor_pays_minor, net_to_cause_minor, currency, status,
    idempotency_key, provider, provider_reference, simulated
  ) VALUES (
    donor, target_campaign, next_recognition, shown_name,
    gift_minor, 0, 0, 0,
    gift_minor, gift_minor, 'KES', 'pending',
    next_idempotency_key, 'mock', reference, true
  ) RETURNING id INTO created_id;
  PERFORM set_config('jirani.trusted_ledger_write', 'off', true);
  PERFORM jirani.write_audit(
    donor, 'contribution.started', 'contribution', created_id,
    'Simulated campaign contribution started. No money has moved.',
    jsonb_build_object('campaignId', target_campaign, 'giftMinor', gift_minor)
  );
  RETURN jsonb_build_object(
    'id', created_id, 'providerReference', reference, 'status', 'pending', 'duplicate', false
  );
EXCEPTION
  WHEN unique_violation THEN
    PERFORM set_config('jirani.trusted_ledger_write', 'off', true);
    SELECT id, contributions.gift_minor, donor_profile_id, provider_reference, status
      INTO existing_id, existing_gift, existing_donor, existing_reference, existing_status
    FROM contributions WHERE idempotency_key = next_idempotency_key;
    IF existing_donor IS DISTINCT FROM donor OR existing_gift IS DISTINCT FROM gift_minor THEN
      RAISE EXCEPTION 'that idempotency key was already used';
    END IF;
    RETURN jsonb_build_object(
      'id', existing_id, 'providerReference', existing_reference, 'status', existing_status, 'duplicate', true
    );
END;
$$;

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
    JOIN campaigns camp ON camp.id = c.campaign_id
    WHERE c.campaign_id = target
      AND camp.status IN ('active', 'closed', 'reconciling', 'reported')
      AND c.status = 'successful'
      AND c.simulated = true
  ) gifts
  WHERE remaining_minor > 0
  ORDER BY settled_at NULLS LAST, created_at
$$;

CREATE OR REPLACE FUNCTION jirani.public_campaign_report(target uuid)
RETURNS TABLE (
  narrative text,
  raised_minor bigint,
  contribution_count integer,
  platform_fee_minor bigint,
  allocated_minor bigint,
  paid_minor bigint,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    reports.narrative,
    reports.gross_gift_minor,
    jirani.campaign_contribution_count(reports.campaign_id),
    reports.platform_fee_minor,
    coalesce((SELECT allocated_amount_minor FROM campaign_selections WHERE campaign_id = reports.campaign_id), 0),
    reports.disbursement_approved_minor,
    reports.published_at
  FROM reports
  JOIN campaigns ON campaigns.id = reports.campaign_id
  WHERE reports.campaign_id = target
    AND campaigns.status = 'reported'
  ORDER BY reports.published_at DESC
  LIMIT 1
$$;

DROP FUNCTION jirani.donor_contributions(uuid);
CREATE FUNCTION jirani.donor_contributions(target uuid)
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
    c.public_name,
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

DROP POLICY IF EXISTS campaigns_select ON campaigns;
CREATE POLICY campaigns_select ON campaigns FOR SELECT
  USING (
    jirani.is_admin()
    OR status IN ('scheduled', 'active', 'closed', 'reconciling', 'reported')
    OR (status = 'cancelled' AND approved_at IS NOT NULL)
  );

ALTER TABLE campaign_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_status_events FORCE ROW LEVEL SECURITY;
ALTER TABLE campaign_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_selections FORCE ROW LEVEL SECURITY;
ALTER TABLE campaign_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_reconciliations FORCE ROW LEVEL SECURITY;

CREATE POLICY campaign_events_admin ON campaign_status_events FOR SELECT USING (jirani.is_admin());
CREATE POLICY campaign_selections_admin ON campaign_selections FOR SELECT USING (jirani.is_admin());
CREATE POLICY campaign_reconciliations_admin ON campaign_reconciliations FOR SELECT USING (jirani.is_admin());

REVOKE INSERT, UPDATE, DELETE ON campaigns FROM jirani_app;
REVOKE ALL ON campaign_status_events FROM jirani_app;
REVOKE ALL ON campaign_selections FROM jirani_app;
REVOKE ALL ON campaign_reconciliations FROM jirani_app;
GRANT SELECT ON campaign_status_events, campaign_selections, campaign_reconciliations TO jirani_app;

REVOKE ALL ON FUNCTION jirani.raised_for_campaign(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.campaign_contribution_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.save_campaign(uuid, text, text, text, text, bigint, timestamptz, timestamptz, text, text, text, text, text, text, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.transition_campaign(uuid, campaign_status, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.record_campaign_selection(uuid, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.publish_campaign_report(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.record_simulated_campaign_contribution(uuid, bigint, recognition, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.public_campaign_acknowledgements(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.public_campaign_report(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.donor_contributions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jirani.raised_for_campaign(uuid) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.campaign_contribution_count(uuid) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.save_campaign(uuid, text, text, text, text, bigint, timestamptz, timestamptz, text, text, text, text, text, text, text, boolean, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.transition_campaign(uuid, campaign_status, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.record_campaign_selection(uuid, text, text, bigint) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.publish_campaign_report(uuid, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.record_simulated_campaign_contribution(uuid, bigint, recognition, text, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.public_campaign_acknowledgements(uuid) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.public_campaign_report(uuid) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.donor_contributions(uuid) TO jirani_app;

COMMENT ON TABLE campaign_reconciliations IS
  'A snapshot taken when reconciliation starts. funds_sent stays false. Closing the campaign does not pay anyone.';
COMMENT ON TABLE campaign_selections IS
  'One manual selection per campaign. It is not public and cannot be replaced to force a different outcome.';

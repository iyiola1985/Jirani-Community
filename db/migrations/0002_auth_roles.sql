-- Auth, profile fields, and role protections.
-- Apply after 0001. This file does not insert an administrator.
-- The policies below were not executed against a live database in the
-- development environment that wrote them. Apply them on your own Postgres
-- or Supabase database before treating them as active.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'corporate_partner';

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS county text,
  ADD COLUMN IF NOT EXISTS phone_verification_status text NOT NULL DEFAULT 'not_started';

UPDATE profiles
SET display_name = public_display_name
WHERE display_name IS NULL;

ALTER TABLE profiles
  ALTER COLUMN display_name SET NOT NULL;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_account_status_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('active', 'suspended', 'closed'));

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_language_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_language_check
  CHECK (preferred_language IN ('en', 'sw'));

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_phone_verification_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_phone_verification_check
  CHECK (phone_verification_status IN ('not_started', 'pending', 'verified'));

ALTER TABLE recipient_verifications
  ADD COLUMN IF NOT EXISTS verification_type text NOT NULL DEFAULT 'identity',
  ADD COLUMN IF NOT EXISTS review_notes text;

ALTER TABLE recipient_verifications DROP CONSTRAINT IF EXISTS recipient_verifications_type_check;
ALTER TABLE recipient_verifications
  ADD CONSTRAINT recipient_verifications_type_check
  CHECK (verification_type IN ('identity', 'need', 'organisation'));

ALTER TABLE consent_records
  ADD COLUMN IF NOT EXISTS consent_status text NOT NULL DEFAULT 'granted';

ALTER TABLE consent_records DROP CONSTRAINT IF EXISTS consent_records_status_check;
ALTER TABLE consent_records
  ADD CONSTRAINT consent_records_status_check
  CHECK (consent_status IN ('granted', 'withdrawn'));

CREATE OR REPLACE FUNCTION jirani.profile_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  configured text := nullif(current_setting('jirani.profile_id', true), '');
  uid uuid;
BEGIN
  IF configured IS NOT NULL THEN
    RETURN configured::uuid;
  END IF;
  IF to_regnamespace('auth') IS NOT NULL AND to_regprocedure('auth.uid()') IS NOT NULL THEN
    EXECUTE 'SELECT auth.uid()' INTO uid;
    RETURN uid;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION jirani.role_list() RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT concat_ws(
    ',',
    nullif(current_setting('jirani.roles', true), ''),
    (
      SELECT string_agg(role::text, ',')
      FROM public.user_roles
      WHERE profile_id = jirani.profile_id()
    )
  )
$$;

CREATE OR REPLACE FUNCTION jirani.is_admin() RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT position('administrator' IN coalesce(current_setting('jirani.roles', true), '')) > 0
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE profile_id = jirani.profile_id() AND role = 'administrator'
    )
$$;

CREATE OR REPLACE FUNCTION jirani.protect_profile_privileges() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.email IS DISTINCT FROM OLD.email THEN
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

DROP TRIGGER IF EXISTS profiles_protect_privileges ON profiles;
CREATE TRIGGER profiles_protect_privileges
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION jirani.protect_profile_privileges();

CREATE OR REPLACE FUNCTION jirani.trusted_writer() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_user IS DISTINCT FROM session_user
    OR EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname = current_user AND rolsuper
    )
$$;

CREATE OR REPLACE FUNCTION jirani.protect_roles() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('jirani.trusted_role_write', true) IS DISTINCT FROM 'on' OR NOT jirani.trusted_writer() THEN
      RAISE EXCEPTION 'roles cannot be edited directly';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    current_setting('jirani.trusted_role_write', true) IS DISTINCT FROM 'on'
    OR NOT jirani.trusted_writer()
  ) THEN
    RAISE EXCEPTION 'roles cannot be edited directly';
  END IF;
  IF NEW.role = 'administrator'
     AND (
       current_setting('jirani.trusted_role_write', true) IS DISTINCT FROM 'on'
       OR NOT jirani.trusted_writer()
     ) THEN
    RAISE EXCEPTION 'administrator cannot be self-assigned';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_protect ON user_roles;
CREATE TRIGGER user_roles_protect
  BEFORE INSERT OR UPDATE OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION jirani.protect_roles();

CREATE OR REPLACE FUNCTION jirani.block_self_verification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.profile_id = jirani.profile_id()
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.review_notes IS DISTINCT FROM OLD.review_notes OR NEW.review_reason IS DISTINCT FROM OLD.review_reason) THEN
    RAISE EXCEPTION 'you cannot review your own verification';
  END IF;
  IF NEW.reviewer_id IS NOT NULL AND NEW.reviewer_id = NEW.profile_id THEN
    RAISE EXCEPTION 'you cannot review your own verification';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recipient_verifications_no_self ON recipient_verifications;
CREATE TRIGGER recipient_verifications_no_self
  BEFORE UPDATE ON recipient_verifications
  FOR EACH ROW EXECUTE FUNCTION jirani.block_self_verification();

CREATE OR REPLACE FUNCTION jirani.protect_audit_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('jirani.trusted_audit_write', true) IS DISTINCT FROM 'on' OR NOT jirani.trusted_writer() THEN
    RAISE EXCEPTION 'audit logs are written by authorised operations';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_protect_insert ON administrative_audit_logs;
CREATE TRIGGER audit_protect_insert
  BEFORE INSERT ON administrative_audit_logs
  FOR EACH ROW EXECUTE FUNCTION jirani.protect_audit_insert();

DROP POLICY IF EXISTS audit_insert ON administrative_audit_logs;
CREATE POLICY audit_insert ON administrative_audit_logs FOR INSERT
  WITH CHECK (
    current_setting('jirani.trusted_audit_write', true) = 'on'
    AND jirani.trusted_writer()
  );

CREATE OR REPLACE FUNCTION jirani.write_audit(
  actor uuid,
  action text,
  target_type text,
  target_id uuid,
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created uuid;
BEGIN
  IF jirani.profile_id() IS DISTINCT FROM actor AND NOT jirani.is_admin() THEN
    RAISE EXCEPTION 'the audit actor must be the signed-in user';
  END IF;
  PERFORM set_config('jirani.trusted_audit_write', 'on', true);
  INSERT INTO administrative_audit_logs (actor_id, action, entity_type, entity_id, reason, metadata)
  VALUES (actor, action, target_type, target_id, reason, coalesce(metadata, '{}'::jsonb))
  RETURNING id INTO created;
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION jirani.assign_role(target uuid, next_role user_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF next_role = 'administrator' THEN
    IF NOT jirani.is_admin() THEN
      RAISE EXCEPTION 'only an administrator can assign that role';
    END IF;
    IF target = jirani.profile_id() THEN
      RAISE EXCEPTION 'you cannot grant yourself administrator';
    END IF;
  ELSIF jirani.profile_id() IS DISTINCT FROM target AND NOT jirani.is_admin() THEN
    RAISE EXCEPTION 'you cannot assign a role for another person';
  END IF;
  PERFORM set_config('jirani.trusted_role_write', 'on', true);
  INSERT INTO user_roles (profile_id, role, granted_by)
  VALUES (target, next_role, jirani.profile_id())
  ON CONFLICT (profile_id, role) DO NOTHING;
  PERFORM jirani.write_audit(
    jirani.profile_id(),
    'role.assigned',
    'user_role',
    target,
    'Role assignment recorded.',
    jsonb_build_object('role', next_role)
  );
END;
$$;

-- Manual first-administrator step. Not granted to application roles.
CREATE OR REPLACE FUNCTION jirani.bootstrap_administrator(target uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = target) THEN
    RAISE EXCEPTION 'create the profile before granting administrator';
  END IF;
  PERFORM set_config('jirani.trusted_role_write', 'on', true);
  INSERT INTO user_roles (profile_id, role)
  VALUES (target, 'administrator')
  ON CONFLICT (profile_id, role) DO NOTHING;
  PERFORM set_config('jirani.trusted_audit_write', 'on', true);
  INSERT INTO administrative_audit_logs (actor_id, action, entity_type, entity_id, reason, metadata)
  VALUES (NULL, 'role.bootstrap_administrator', 'profile', target, 'First administrator granted from the database console.', '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION jirani.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested text := coalesce(NEW.raw_user_meta_data->>'role', 'donor');
  display text := left(coalesce(NULLIF(NEW.raw_user_meta_data->>'display_name', ''), split_part(NEW.email, '@', 1), 'Neighbour'), 80);
BEGIN
  IF char_length(display) < 2 THEN
    display := 'Neighbour';
  END IF;
  IF requested NOT IN ('recipient', 'donor', 'corporate_partner') THEN
    requested := 'donor';
  END IF;
  PERFORM set_config('jirani.trusted_role_write', 'on', true);
  INSERT INTO public.profiles (id, public_display_name, display_name, email, phone, county, account_status, preferred_language)
  VALUES (
    NEW.id,
    display,
    display,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NULLIF(NEW.raw_user_meta_data->>'county', ''),
    'active',
    'en'
  )
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (profile_id, role)
  VALUES (NEW.id, requested::user_role)
  ON CONFLICT (profile_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION jirani.handle_new_user();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION jirani.bootstrap_administrator(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.assign_role(uuid, user_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.write_audit(uuid, text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE INSERT ON administrative_audit_logs FROM jirani_app;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON administrative_audit_logs FROM %I', role_name);
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON user_roles FROM %I', role_name);
      EXECUTE format('REVOKE UPDATE (account_status, phone_verification_status, email) ON profiles FROM %I', role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT USAGE ON SCHEMA public, jirani TO authenticated;
    GRANT SELECT ON profiles, user_roles, recipient_verifications, consent_records TO authenticated;
    GRANT UPDATE (public_display_name, display_name, preferred_language, county, phone) ON profiles TO authenticated;
    GRANT EXECUTE ON FUNCTION jirani.assign_role(uuid, user_role) TO authenticated;
    GRANT SELECT ON public_assistance_requests, campaigns, reports TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT USAGE ON SCHEMA public TO anon;
    GRANT SELECT ON public_assistance_requests, campaigns, reports TO anon;
  END IF;
END;
$$;

COMMENT ON COLUMN profiles.id IS
  'Same identifier as the authentication user. profiles.id is the user id.';
COMMENT ON COLUMN profiles.display_name IS
  'Kept alongside public_display_name. Profile edits may change both.';
COMMENT ON COLUMN user_roles.profile_id IS
  'The authenticated user. This is the user_id named in the product schema.';
COMMENT ON COLUMN user_roles.granted_at IS
  'When the role was assigned.';
COMMENT ON COLUMN user_roles.granted_by IS
  'Who assigned the role. Null for the bootstrap administrator.';
COMMENT ON COLUMN recipient_verifications.review_notes IS
  'Private reviewer notes. Not a public document URL.';
COMMENT ON COLUMN consent_records.granted_at IS
  'When consent was recorded.';
COMMENT ON COLUMN profiles.phone_verification_status IS
  'Prepared for a future SMS provider. This build never sets it to verified.';
COMMENT ON FUNCTION jirani.bootstrap_administrator(uuid) IS
  'Run once from the database owner session to appoint the first administrator.';

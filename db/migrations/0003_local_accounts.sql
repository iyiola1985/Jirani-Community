-- Local account sign-in.
-- Password hashes live here, never in profiles, and never as the original password.
-- Row-level security has no policy on this table, so the application role cannot read it.
-- Only the security-definer functions below may insert or look up a hash.

CREATE TABLE auth_credentials (
  profile_id uuid PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  password_hash text NOT NULL CHECK (password_hash ~ '^scrypt:[0-9a-f]+:[0-9a-f]+$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auth_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_credentials FORCE ROW LEVEL SECURITY;

REVOKE ALL ON auth_credentials FROM PUBLIC;
REVOKE ALL ON auth_credentials FROM jirani_app;

CREATE OR REPLACE FUNCTION jirani.register_account(
  new_id uuid,
  display text,
  account_email text,
  account_phone text,
  account_county text,
  next_role user_role,
  password_hash text,
  policy_version text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF next_role = 'administrator' OR next_role NOT IN ('recipient', 'donor', 'corporate_partner') THEN
    RAISE EXCEPTION 'that role cannot be chosen at registration';
  END IF;
  IF password_hash !~ '^scrypt:[0-9a-f]+:[0-9a-f]+$' THEN
    RAISE EXCEPTION 'password hash is not in the expected form';
  END IF;
  IF char_length(display) < 2 OR char_length(display) > 80 THEN
    RAISE EXCEPTION 'display name must be between 2 and 80 characters';
  END IF;
  PERFORM set_config('jirani.trusted_role_write', 'on', true);
  INSERT INTO profiles (id, public_display_name, display_name, email, phone, county, account_status, preferred_language)
  VALUES (
    new_id,
    display,
    display,
    account_email,
    NULLIF(account_phone, ''),
    NULLIF(account_county, ''),
    'active',
    'en'
  );
  INSERT INTO user_roles (profile_id, role)
  VALUES (new_id, next_role);
  INSERT INTO auth_credentials (profile_id, password_hash)
  VALUES (new_id, password_hash);
  INSERT INTO consent_records (profile_id, consent_type, policy_version, consent_status)
  VALUES
    (new_id, 'terms', policy_version, 'granted'),
    (new_id, 'privacy', policy_version, 'granted');
END;
$$;

CREATE OR REPLACE FUNCTION jirani.account_for_login(lookup_email text)
RETURNS TABLE (profile_id uuid, display_name text, password_hash text, roles text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.display_name,
    c.password_hash,
    COALESCE((
      SELECT array_agg(ur.role::text)
      FROM user_roles ur
      WHERE ur.profile_id = p.id
    ), ARRAY[]::text[])
  FROM profiles p
  JOIN auth_credentials c ON c.profile_id = p.id
  WHERE lower(p.email) = lower(lookup_email)
    AND p.account_status = 'active'
$$;

CREATE OR REPLACE FUNCTION jirani.account_for_session(target uuid)
RETURNS TABLE (profile_id uuid, display_name text, roles text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.display_name,
    COALESCE((
      SELECT array_agg(ur.role::text)
      FROM user_roles ur
      WHERE ur.profile_id = p.id
    ), ARRAY[]::text[])
  FROM profiles p
  WHERE p.id = target
    AND p.account_status = 'active'
$$;

REVOKE ALL ON FUNCTION jirani.register_account(uuid, text, text, text, text, user_role, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.account_for_login(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jirani.account_for_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jirani.register_account(uuid, text, text, text, text, user_role, text, text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.account_for_login(text) TO jirani_app;
GRANT EXECUTE ON FUNCTION jirani.account_for_session(uuid) TO jirani_app;

DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT, TEMP ON DATABASE %I TO jirani_app', current_database());
END;
$$;

COMMENT ON TABLE auth_credentials IS
  'Scrypt password hashes for local sign-in. Supabase Auth replaces this table when it is configured. The hash is not the password.';

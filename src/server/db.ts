/** Set inside a transaction before queries when PostgreSQL is connected. */
export const ACTOR_SESSION_SQL = `
  SELECT set_config('jirani.profile_id', $1, true),
         set_config('jirani.roles', $2, true)
`;

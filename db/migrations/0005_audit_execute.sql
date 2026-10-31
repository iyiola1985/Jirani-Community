-- The application records review decisions through jirani.write_audit.
-- The function checks the signed-in actor. It was revoked from PUBLIC in 0002
-- and was not granted to the application role.

GRANT EXECUTE ON FUNCTION jirani.write_audit(uuid, text, text, uuid, text, jsonb) TO jirani_app;

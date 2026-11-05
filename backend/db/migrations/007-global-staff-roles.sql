-- Restore one global staff role without discarding store assignments.
BEGIN;

-- Do not silently choose which role wins if mixed roles have been used.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM user_stores us JOIN users u USING (user_id)
        WHERE u.role <> 'system_admin'
        GROUP BY us.user_id HAVING COUNT(DISTINCT us.role) > 1
    ) THEN
        RAISE EXCEPTION 'Mixed store roles exist. Choose one role per user in user_stores before retrying migration 007.';
    END IF;
END $$;

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('user', 'store_buyer', 'store_admin', 'system_admin'));

UPDATE users u SET role = roles.role, updated_at = CURRENT_TIMESTAMP
FROM (SELECT user_id, MIN(role) AS role FROM user_stores GROUP BY user_id) roles
WHERE u.user_id = roles.user_id AND u.role <> 'system_admin';

ALTER TABLE user_stores DROP COLUMN role;
COMMIT;

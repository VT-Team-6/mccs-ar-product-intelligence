-- Preserve each existing store assignment's former global staff role.
BEGIN;

ALTER TABLE user_stores ADD COLUMN role VARCHAR(20);

UPDATE user_stores us
SET role = CASE WHEN u.role = 'store_admin' THEN 'store_admin'
                ELSE 'store_buyer' END
FROM users u
WHERE u.user_id = us.user_id;

ALTER TABLE user_stores ALTER COLUMN role SET NOT NULL;
ALTER TABLE user_stores ADD CONSTRAINT user_stores_role_check
    CHECK (role IN ('store_buyer', 'store_admin'));

UPDATE users SET role = 'user', updated_at = CURRENT_TIMESTAMP
WHERE role IN ('store_buyer', 'store_admin');

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('user', 'system_admin'));

COMMIT;
